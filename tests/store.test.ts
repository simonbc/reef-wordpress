import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDocumentStore } from "../src/store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("document store", () => {
  test("creates local markdown posts with frontmatter", async () => {
    const root = await tempRoot();
    const store = createDocumentStore(root);

    const document = await store.save({
      type: "post",
      title: "Hello WordPress",
      markdown: "This is local source.",
      status: "local-draft",
    });

    expect(document.slug).toBe("hello-wordpress");
    await expect(readFile(join(root, "posts", "hello-wordpress.md"), "utf8")).resolves.toContain(
      "status: local-draft",
    );
  });

  test("lists posts newest first and pages alphabetically", async () => {
    const root = await tempRoot();
    const store = createDocumentStore(root);

    await store.save({ type: "post", title: "Older", markdown: "Old", date: "2026-05-01" });
    await store.save({ type: "post", title: "Newer", markdown: "New", date: "2026-06-01" });
    await store.save({ type: "page", title: "Contact", markdown: "Email me" });
    await store.save({ type: "page", title: "About", markdown: "About me" });

    await expect(store.list("post")).resolves.toMatchObject([
      { title: "Newer" },
      { title: "Older" },
    ]);
    await expect(store.list("page")).resolves.toMatchObject([
      { title: "About" },
      { title: "Contact" },
    ]);
  });

  test("records WordPress.com publish state without changing markdown source", async () => {
    const root = await tempRoot();
    const store = createDocumentStore(root);
    const document = await store.save({ type: "post", title: "Publish Me", markdown: "Body" });

    await store.setWordPressState(document.id, {
      remoteId: 42,
      url: "https://example.wordpress.com/2026/06/01/publish-me/",
      status: "draft",
    });

    await expect(store.read(document.id)).resolves.toMatchObject({
      title: "Publish Me",
      wordpress: {
        remoteId: 42,
        status: "draft",
      },
    });
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reef-wordpress-store-"));
  roots.push(root);
  return root;
}
