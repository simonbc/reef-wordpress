import { describe, expect, test } from "bun:test";
import { oauthConfigFromEnv, startServer } from "../src/server";

describe("server", () => {
  test("reads WordPress.com OAuth client settings from environment", () => {
    expect(
      oauthConfigFromEnv({
        REEF_WORDPRESS_COM_CLIENT_ID: "client-123",
        REEF_WORDPRESS_COM_CLIENT_SECRET: "secret",
      }),
    ).toEqual({
      clientId: "client-123",
      clientSecret: "secret",
    });
    expect(oauthConfigFromEnv({})).toBeUndefined();
  });

  test("passes a fetch handler to Bun.serve", () => {
    let fetchHandler: ((request: Request) => Response | Promise<Response>) | undefined;
    const server = startServer({
      root: "/tmp/reef-wordpress",
      port: 4123,
      serve: (options) => {
        fetchHandler = options.fetch;
        return {
          port: options.port,
          stop: () => {},
        } as ReturnType<typeof Bun.serve>;
      },
    });

    expect(server.url).toBe("http://localhost:4123");
    expect(fetchHandler).toBeFunction();
  });
});
