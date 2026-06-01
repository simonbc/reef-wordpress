import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(body).toContain("/auth/wordpress/start");
    expect(body).not.toContain('name="site"');
    expect(body).not.toContain("wp-admin");
  });

  test("starts WordPress.com OAuth without requiring site details", async () => {
    const root = await tempRoot();
    const app = createApp({
      root,
      wordpressOAuth: {
        clientId: "client-123",
        clientSecret: "secret",
      },
      randomState: () => "state-abc",
    });

    const response = await app.fetch(
      new Request("http://localhost:3000/auth/wordpress/start", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toStartWith("https://public-api.wordpress.com/oauth2/authorize?");
    expect(location).toContain("client_id=client-123");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fwordpress%2Fcallback");
    expect(location).toContain("response_type=code");
    expect(location).not.toContain("blog=");
    expect(location).toContain("scope=global");
    expect(location).toContain("state=state-abc");
    await expect(readFile(join(root, ".reef", "state", "oauth-state.json"), "utf8")).resolves.toContain(
      "state-abc",
    );
  });

  test("handles WordPress.com OAuth callback and auto-selects a single site", async () => {
    const root = await tempRoot();
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
        if (String(url).endsWith("/me/sites")) {
          return Response.json({
            sites: [
              {
                ID: 123,
                name: "Simon",
                URL: "https://simon.wordpress.com",
              },
            ],
          });
        }
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
    await expect(readFile(join(root, "reef.toml"), "utf8")).resolves.toContain(
      'site_id = "123"',
    );
    await expect(readFile(join(root, "reef.toml"), "utf8")).resolves.toContain(
      'title = "Simon"',
    );
    await expect(readFile(join(root, "reef.toml"), "utf8")).resolves.not.toContain("oauth-token");
  });

  test("shows a site picker when WordPress.com returns multiple sites", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, ".reef", "state", "oauth-state.json"), '{"state":"state-abc"}');
    const app = createApp({
      root,
      wordpressOAuth: {
        clientId: "client-123",
        clientSecret: "secret",
      },
      fetch: (async (url: string | URL | Request) => {
        if (String(url).endsWith("/me/sites")) {
          return Response.json({
            sites: [
              { ID: 123, name: "Personal", URL: "https://personal.wordpress.com" },
              { ID: 456, name: "Work", URL: "https://work.wordpress.com" },
            ],
          });
        }
        return Response.json({ access_token: "oauth-token", token_type: "bearer" });
      }) as typeof fetch,
    });

    const response = await app.fetch(
      new Request(
        "http://localhost:3000/auth/wordpress/callback?code=code-123&state=state-abc",
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Choose a WordPress.com site");
    expect(body).toContain("Personal");
    expect(body).toContain("Work");
    await expect(
      readFile(join(root, ".reef", "state", "wordpress-sites.json"), "utf8"),
    ).resolves.toContain("456");
  });

  test("serves a calm writing-first home screen after WordPress.com is configured", async () => {
    const root = await tempRoot();
    await Bun.write(
      join(root, "reef.toml"),
      'title = "My Site"\n[wordpress_com]\nsite_id = "123"\nsite_url = "https://example.wordpress.com"\n',
    );
    const app = createApp({ root });
    const body = await app.fetch(new Request("http://reef.local/")).then((res) => res.text());

    expect(body).toContain("<title>My Site - Reef</title>");
    expect(body).toContain('<a href="https://example.wordpress.com" target="_blank" rel="noopener">View site</a>');
    expect(body).toContain("Create");
    expect(body).toContain("Posts");
    expect(body).toContain("Pages");
    expect(body).not.toContain("Dashboard");
    expect(body).not.toContain("wp-admin");
  });

  test("serves a split markdown editor and preview", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite_id = "123"\n');
    const app = createApp({ root });
    const body = await app.fetch(new Request("http://reef.local/new")).then((res) => res.text());

    expect(body).toContain('<textarea name="markdown"');
    expect(body).toContain('class="preview"');
    expect(body).toContain('data-markdown-editor');
    expect(body).toContain('data-markdown-preview');
    expect(body).toContain("renderMarkdown");
    expect(body).toContain("Publish draft");
    expect(body).toContain("Publish");
  });

  test("creates a local post from the editor", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite_id = "123"\n');
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

  test("edits an existing local post from the editor", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite_id = "123"\n');
    await Bun.write(
      join(root, "posts", "hello.md"),
      "---\ntitle: Hello\ndate: 2026-06-01\nstatus: local-draft\n---\n\nOriginal body.",
    );
    const app = createApp({ root });

    const editor = await app
      .fetch(new Request("http://reef.local/posts/hello/edit"))
      .then((res) => res.text());
    expect(editor).toContain('value="Hello"');
    expect(editor).toContain("Original body.");
    expect(editor).toContain('action="/posts/hello"');

    const form = new FormData();
    form.set("title", "Hello Edited");
    form.set("markdown", "Updated body.");

    const response = await app.fetch(
      new Request("http://reef.local/posts/hello", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/posts/hello");
    await expect(Bun.file(join(root, "posts", "hello.md")).text()).resolves.toContain(
      "Updated body.",
    );
  });

  test("shows edit and delete links underneath rendered post content", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite_id = "123"\n');
    await Bun.write(
      join(root, "posts", "hello.md"),
      "---\ntitle: Hello\ndate: 2026-06-01\nstatus: local-draft\n---\n\nRendered body.",
    );
    const app = createApp({ root });

    const body = await app.fetch(new Request("http://reef.local/posts/hello")).then((res) => res.text());

    expect(body).toContain('<nav><a class="button" href="/new">Create</a></nav>');
    expect(body).not.toContain('<nav><a href="/posts/hello/edit">Edit</a>');
    expect(body.indexOf("Rendered body.")).toBeLessThan(body.indexOf('class="article-actions"'));
    expect(body).toContain('<a href="/posts/hello/edit">Edit</a>');
    expect(body).toContain('<form method="post" action="/posts/hello/delete"');
    expect(body).toContain("<button>Delete</button>");
  });

  test("deletes a local post from the rendered post actions", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite_id = "123"\n');
    await Bun.write(
      join(root, "posts", "hello.md"),
      "---\ntitle: Hello\ndate: 2026-06-01\nstatus: local-draft\n---\n\nRendered body.",
    );
    const app = createApp({ root });

    const response = await app.fetch(
      new Request("http://reef.local/posts/hello/delete", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    await expect(Bun.file(join(root, "posts", "hello.md")).exists()).resolves.toBe(false);
  });

  test("edits an existing local page from the editor", async () => {
    const root = await tempRoot();
    await Bun.write(join(root, "reef.toml"), 'title = "My Site"\n[wordpress_com]\nsite_id = "123"\n');
    await Bun.write(
      join(root, "pages", "about.md"),
      "---\ntitle: About\ndate: 2026-06-01\nstatus: local-draft\n---\n\nOriginal page.",
    );
    const app = createApp({ root });

    const editor = await app
      .fetch(new Request("http://reef.local/pages/about/edit"))
      .then((res) => res.text());
    expect(editor).toContain("Original page.");

    const form = new FormData();
    form.set("title", "About");
    form.set("markdown", "Updated page.");

    const response = await app.fetch(
      new Request("http://reef.local/pages/about", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/pages/about");
    await expect(Bun.file(join(root, "pages", "about.md")).text()).resolves.toContain(
      "Updated page.",
    );
  });

  test("publish draft saves locally and publishes to WordPress.com draft", async () => {
    const root = await tempRoot();
    await Bun.write(
      join(root, "reef.toml"),
      'title = "My Site"\n[wordpress_com]\nsite_id = "123"\nsite_url = "https://example.wordpress.com"\n',
    );
    await mkdir(join(root, ".reef", "secrets"), { recursive: true });
    await writeFile(
      join(root, ".reef", "secrets", "wordpress-com.json"),
      JSON.stringify({ accessToken: "oauth-token" }),
    );
    const requests: { url: string; init?: RequestInit; body: Record<string, unknown> }[] = [];
    const app = createApp({
      root,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(url),
          init,
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({
          id: 42,
          link: "https://example.wordpress.com/hello/",
          status: "draft",
        });
      }) as typeof fetch,
    });
    const form = new FormData();
    form.set("type", "post");
    form.set("title", "Publish Me");
    form.set("markdown", "Draft body.");
    form.set("intent", "publish-draft");

    const response = await app.fetch(
      new Request("http://reef.local/documents", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/posts/publish-me");
    expect(requests[0].url).toBe("https://public-api.wordpress.com/wp/v2/sites/123/posts");
    expect(requests[0].body).toMatchObject({
      title: "Publish Me",
      status: "draft",
    });
    await expect(
      readFile(join(root, ".reef", "state", "wordpress-com.json"), "utf8"),
    ).resolves.toContain("42");
  });

  test("publish saves locally and publishes live to WordPress.com", async () => {
    const root = await tempRoot();
    await Bun.write(
      join(root, "reef.toml"),
      'title = "My Site"\n[wordpress_com]\nsite_id = "123"\nsite_url = "https://example.wordpress.com"\n',
    );
    await mkdir(join(root, ".reef", "secrets"), { recursive: true });
    await writeFile(
      join(root, ".reef", "secrets", "wordpress-com.json"),
      JSON.stringify({ accessToken: "oauth-token" }),
    );
    const requests: { url: string; init?: RequestInit; body: Record<string, unknown> }[] = [];
    const app = createApp({
      root,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(url),
          init,
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({
          id: 43,
          link: "https://example.wordpress.com/publish-me-live/",
          status: "publish",
        });
      }) as typeof fetch,
    });
    const form = new FormData();
    form.set("type", "post");
    form.set("title", "Publish Me Live");
    form.set("markdown", "Live body.");
    form.set("intent", "publish");

    const response = await app.fetch(
      new Request("http://reef.local/documents", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/posts/publish-me-live");
    expect(requests[0].body).toMatchObject({
      title: "Publish Me Live",
      status: "publish",
    });
    await expect(
      readFile(join(root, ".reef", "state", "wordpress-com.json"), "utf8"),
    ).resolves.toContain('"status": "publish"');
  });

  test("publish updates a previously published WordPress.com post", async () => {
    const root = await tempRoot();
    await Bun.write(
      join(root, "reef.toml"),
      'title = "My Site"\n[wordpress_com]\nsite_id = "123"\nsite_url = "https://example.wordpress.com"\n',
    );
    await mkdir(join(root, ".reef", "secrets"), { recursive: true });
    await writeFile(
      join(root, ".reef", "secrets", "wordpress-com.json"),
      JSON.stringify({ accessToken: "oauth-token" }),
    );
    await Bun.write(
      join(root, "posts", "hello.md"),
      "---\ntitle: Hello\ndate: 2026-06-01\nstatus: local-draft\n---\n\nOriginal body.",
    );
    await mkdir(join(root, ".reef", "state"), { recursive: true });
    await writeFile(
      join(root, ".reef", "state", "wordpress-com.json"),
      JSON.stringify({
        "post:hello": {
          remoteId: 42,
          url: "https://example.wordpress.com/hello/",
          status: "draft",
        },
      }),
    );
    const requests: { url: string; init?: RequestInit; body: Record<string, unknown> }[] = [];
    const app = createApp({
      root,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(url),
          init,
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({
          id: 42,
          link: "https://example.wordpress.com/hello/",
          status: "publish",
        });
      }) as typeof fetch,
    });
    const form = new FormData();
    form.set("title", "Hello");
    form.set("markdown", "Updated live body.");
    form.set("intent", "publish");

    const response = await app.fetch(
      new Request("http://reef.local/posts/hello", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(requests[0].url).toBe("https://public-api.wordpress.com/wp/v2/sites/123/posts/42");
    expect(requests[0].body).toMatchObject({
      status: "publish",
      content: expect.stringContaining("Updated live body."),
    });
    await expect(
      readFile(join(root, ".reef", "state", "wordpress-com.json"), "utf8"),
    ).resolves.toContain('"status": "publish"');
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reef-wordpress-app-"));
  roots.push(root);
  return root;
}
