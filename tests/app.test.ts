import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("browser app", () => {
  test("starts with WordPress.com connection when the workspace is unconfigured", async () => {
    const root = await tempRoot();
    const app = createApp({ root });
    const body = await app.fetch(new Request("http://reef.local/")).then((res) => res.text());

    expect(body).toContain("Connect WordPress.com");
    expect(body).toContain('name="site"');
    expect(body).toContain("/auth/wordpress/start");
    expect(body).not.toContain("wp-admin");
  });

  test("starts WordPress.com OAuth from the local setup form", async () => {
    const root = await tempRoot();
    const app = createApp({
      root,
      wordpressOAuth: {
        clientId: "client-123",
        clientSecret: "secret",
      },
      randomState: () => "state-abc",
    });
    const form = new FormData();
    form.set("title", "My Site");
    form.set("site", "example.wordpress.com");

    const response = await app.fetch(
      new Request("http://localhost:3000/auth/wordpress/start", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toStartWith("https://public-api.wordpress.com/oauth2/authorize?");
    expect(location).toContain("client_id=client-123");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fwordpress%2Fcallback");
    expect(location).toContain("response_type=code");
    expect(location).toContain("blog=example.wordpress.com");
    expect(location).toContain("scope=global");
    expect(location).toContain("state=state-abc");
    await expect(readFile(join(root, "reef.toml"), "utf8")).resolves.toContain(
      'site = "example.wordpress.com"',
    );
    await expect(readFile(join(root, ".reef", "state", "oauth-state.json"), "utf8")).resolves.toContain(
      "state-abc",
    );
  });

  test("handles WordPress.com OAuth callback and stores token outside reef.toml", async () => {
    const root = await tempRoot();
    await Bun.write(
      join(root, "reef.toml"),
      'title = "My Site"\n[wordpress_com]\nsite = "example.wordpress.com"\n',
    );
    await Bun.write(join(root, ".reef", "state", "oauth-state.json"), '{"state":"state-abc"}');
    const requests: { url: string; init?: RequestInit; body: URLSearchParams }[] = [];
    const app = createApp({
      root,
      wordpressOAuth: {
        clientId: "client-123",
        clientSecret: "secret",
      },
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(url),
          init,
          body: new URLSearchParams(String(init?.body)),
        });
        return Response.json({ access_token: "oauth-token", token_type: "bearer" });
      }) as typeof fetch,
    });

    const response = await app.fetch(
      new Request(
        "http://localhost:3000/auth/wordpress/callback?code=code-123&state=state-abc",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(requests[0].url).toBe("https://public-api.wordpress.com/oauth2/token");
    expect(requests[0].body.get("client_id")).toBe("client-123");
    expect(requests[0].body.get("client_secret")).toBe("secret");
    expect(requests[0].body.get("code")).toBe("code-123");
    expect(requests[0].body.get("grant_type")).toBe("authorization_code");
    expect(requests[0].body.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/wordpress/callback",
    );
    await expect(
      readFile(join(root, ".reef", "secrets", "wordpress-com.json"), "utf8"),
    ).resolves.toContain("oauth-token");
    await expect(readFile(join(root, "reef.toml"), "utf8")).resolves.not.toContain(
      "oauth-token",
    );
  });

  test("serves a calm writing-first home screen after WordPress.com is configured", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite = "example.wordpress.com"\n');
    const app = createApp({ root });
    const body = await app.fetch(new Request("http://reef.local/")).then((res) => res.text());

    expect(body).toContain("Create");
    expect(body).toContain("Posts");
    expect(body).toContain("Pages");
    expect(body).not.toContain("Dashboard");
    expect(body).not.toContain("wp-admin");
  });

  test("serves a split markdown editor and preview", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite = "example.wordpress.com"\n');
    const app = createApp({ root });
    const body = await app.fetch(new Request("http://reef.local/new")).then((res) => res.text());

    expect(body).toContain('<textarea name="markdown"');
    expect(body).toContain('class="preview"');
    expect(body).toContain("Publish draft");
  });

  test("creates a local post from the editor", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite = "example.wordpress.com"\n');
    const app = createApp({ root });
    const form = new FormData();
    form.set("type", "post");
    form.set("title", "A Quiet Start");
    form.set("markdown", "First local draft.");

    const response = await app.fetch(
      new Request("http://reef.local/documents", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/posts/a-quiet-start");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reef-wordpress-app-"));
  roots.push(root);
  return root;
}
