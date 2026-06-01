import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isConfigured, loadConfig, saveWordPressComConfig } from "../src/config";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project config", () => {
  test("stores WordPress.com site settings in reef.toml", async () => {
    const root = await tempRoot();

    await saveWordPressComConfig(root, {
      title: "Simon",
      site: "simon.wordpress.com",
    });

    await expect(readFile(join(root, "reef.toml"), "utf8")).resolves.toBe(
      [
        'title = "Simon"',
        "",
        "[wordpress_com]",
        'site = "simon.wordpress.com"',
        "",
      ].join("\n"),
    );
    await expect(loadConfig(root)).resolves.toMatchObject({
      title: "Simon",
      wordpressCom: {
        site: "simon.wordpress.com",
      },
    });
  });

  test("treats missing WordPress.com site config as unconfigured", async () => {
    const root = await tempRoot();

    await expect(loadConfig(root)).resolves.toEqual({
      title: "Reef",
      wordpressCom: null,
    });
    await expect(isConfigured(root)).resolves.toBe(false);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reef-wordpress-config-"));
  roots.push(root);
  return root;
}
