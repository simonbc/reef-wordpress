import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildWordPressAuthorizeUrl,
  exchangeWordPressCode,
  readWordPressToken,
  saveOAuthState,
  saveWordPressToken,
} from "../src/oauth";

const roots: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WordPress.com OAuth", () => {
  test("builds a WordPress.com authorization URL for local callback", () => {
    const url = new URL(
      buildWordPressAuthorizeUrl({
        clientId: "client-123",
        redirectUri: "http://localhost:3000/auth/wordpress/callback",
        site: "example.wordpress.com",
        state: "state-abc",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://public-api.wordpress.com/oauth2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/wordpress/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("blog")).toBe("example.wordpress.com");
    expect(url.searchParams.get("scope")).toBe("global");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });

  test("exchanges an authorization code for a WordPress.com token", async () => {
    const requests: { url: string; init?: RequestInit; body: URLSearchParams }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        init,
        body: new URLSearchParams(String(init?.body)),
      });
      return Response.json({ access_token: "oauth-token", token_type: "bearer" });
    }) as typeof fetch;

    await expect(
      exchangeWordPressCode({
        clientId: "client-123",
        clientSecret: "secret",
        code: "code-123",
        redirectUri: "http://localhost:3000/auth/wordpress/callback",
      }),
    ).resolves.toBe("oauth-token");

    expect(requests[0].url).toBe("https://public-api.wordpress.com/oauth2/token");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(requests[0].body.get("client_id")).toBe("client-123");
    expect(requests[0].body.get("client_secret")).toBe("secret");
    expect(requests[0].body.get("grant_type")).toBe("authorization_code");
    expect(requests[0].body.get("code")).toBe("code-123");
  });

  test("stores oauth state and tokens outside reef.toml", async () => {
    const root = await tempRoot();

    await saveOAuthState(root, "state-abc");
    await saveWordPressToken(root, "oauth-token");

    await expect(readFile(join(root, ".reef", "state", "oauth-state.json"), "utf8")).resolves.toBe(
      '{\n  "state": "state-abc"\n}',
    );
    await expect(readWordPressToken(root)).resolves.toBe("oauth-token");
    await expect(readFile(join(root, ".reef", "secrets", "wordpress-com.json"), "utf8")).resolves.toBe(
      '{\n  "accessToken": "oauth-token"\n}',
    );
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reef-wordpress-oauth-"));
  roots.push(root);
  return root;
}
