import { createApp } from "./app";

export type ReefServer = {
  url: string;
  port: number;
  stop(): void;
};

export function startServer(input: {
  root: string;
  port?: number;
  serve?: typeof Bun.serve;
}): ReefServer {
  const app = createApp({ root: input.root });
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
