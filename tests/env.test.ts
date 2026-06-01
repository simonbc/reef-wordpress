import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDotEnv } from "../src/env";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("dotenv loading", () => {
  test("loads local .env values without overwriting existing environment", async () => {
    const root = await tempRoot();
    await writeFile(
      join(root, ".env"),
      [
        "REEF_WORDPRESS_COM_CLIENT_ID=client-from-file",
        'REEF_WORDPRESS_COM_CLIENT_SECRET="secret from file"',
        "EXISTING=from-file",
        "# comment",
        "",
      ].join("\n"),
    );

    const env: Record<string, string | undefined> = {
      EXISTING: "from-env",
    };

    await loadDotEnv(root, env);

    expect(env.REEF_WORDPRESS_COM_CLIENT_ID).toBe("client-from-file");
    expect(env.REEF_WORDPRESS_COM_CLIENT_SECRET).toBe("secret from file");
    expect(env.EXISTING).toBe("from-env");
  });

  test("ignores missing .env files", async () => {
    const env: Record<string, string | undefined> = {};

    await expect(loadDotEnv(await tempRoot(), env)).resolves.toBeUndefined();
    expect(env).toEqual({});
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reef-wordpress-env-"));
  roots.push(root);
  return root;
}
