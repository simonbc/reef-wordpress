import { createApp } from "./app";
import type { WordPressOAuthConfig } from "./oauth";

export type ReefServer = {
  url: string;
  port: number;
  stop(): void;
};

export function startServer(input: {
  root: string;
  port?: number;
  serve?: typeof Bun.serve;
  wordpressOAuth?: WordPressOAuthConfig;
}): ReefServer {
  const app = createApp({
    root: input.root,
    wordpressOAuth: input.wordpressOAuth,
  });
  const serve = input.serve ?? Bun.serve;
  const server = serve({
    port: input.port ?? 3000,
    fetch: app.fetch,
  });
  return {
    url: `http://localhost:${server.port}`,
    port: server.port,
    stop: () => server.stop(),
  };
}

export function oauthConfigFromEnv(
  env: Partial<Record<"REEF_WORDPRESS_COM_CLIENT_ID" | "REEF_WORDPRESS_COM_CLIENT_SECRET", string>>,
): WordPressOAuthConfig | undefined {
  const clientId = env.REEF_WORDPRESS_COM_CLIENT_ID?.trim();
  const clientSecret = env.REEF_WORDPRESS_COM_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}
