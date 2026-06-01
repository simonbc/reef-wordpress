import { afterEach, describe, expect, test } from "bun:test";
import { createWordPressComClient, listWordPressComSites } from "../src/wordpress-com";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("WordPress.com client", () => {
  test("creates WordPress.com posts through the public-api wp/v2 endpoint", async () => {
    const requests: { url: string; init?: RequestInit; body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init, body: JSON.parse(String(init?.body)) });
      return Response.json({
        id: 42,
        link: "https://example.wordpress.com/hello/",
        status: "draft",
      });
    }) as typeof fetch;

    const client = createWordPressComClient({
      site: "example.wordpress.com",
      token: "secret-token",
    });

    await expect(
      client.publish({
        type: "post",
        title: "Hello",
        html: "<p>Hello</p>",
        status: "draft",
      }),
    ).resolves.toEqual({
      remoteId: 42,
      url: "https://example.wordpress.com/hello/",
      status: "draft",
    });

    expect(requests[0].url).toBe(
      "https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/posts",
    );
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.headers).toMatchObject({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(requests[0].body).toMatchObject({
      title: "Hello",
      content: "<p>Hello</p>",
      status: "draft",
    });
  });

  test("updates pages through the page endpoint", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json({
        id: 7,
        link: "https://example.wordpress.com/about/",
        status: "publish",
      });
    }) as typeof fetch;

    const client = createWordPressComClient({
      site: "example.wordpress.com",
      token: "secret-token",
    });

    await client.update({
      type: "page",
      remoteId: 7,
      title: "About",
      html: "<p>About</p>",
      status: "publish",
    });

    expect(requests[0].url).toBe(
      "https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/pages/7",
    );
  });

  test("lists WordPress.com sites for the authenticated user", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json({
        sites: [
          {
            ID: 123,
            name: "Simon",
            URL: "https://simon.wordpress.com",
          },
        ],
      });
    }) as typeof fetch;

    await expect(listWordPressComSites({ token: "oauth-token" })).resolves.toEqual([
      {
        id: "123",
        title: "Simon",
        url: "https://simon.wordpress.com",
      },
    ]);

    expect(requests[0].url).toBe("https://public-api.wordpress.com/rest/v1.1/me/sites");
    expect(requests[0].init?.headers).toMatchObject({
      authorization: "Bearer oauth-token",
    });
  });
});
