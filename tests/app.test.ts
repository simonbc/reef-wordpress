import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
    expect(body).toContain('name="token_env"');
    expect(body).not.toContain("wp-admin");
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
