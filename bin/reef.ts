#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { oauthConfigFromEnv, startServer } from "../src/server";

const port = Number(process.env.REEF_PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("REEF_PORT must be an integer from 1 to 65535.");
}

const server = startServer({
  root: process.cwd(),
  port,
  wordpressOAuth: oauthConfigFromEnv(process.env),
});
console.log(`Reef is running at ${server.url}`);
openBrowser(server.url);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});

await new Promise(() => {});

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}
