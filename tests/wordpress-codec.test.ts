import { describe, expect, test } from "bun:test";
import {
  markdownToWordPressBlocks,
  wordpressBlocksToMarkdown,
} from "../src/wordpress-codec";

describe("WordPress content codec", () => {
  test("converts markdown into editable Gutenberg block markup", () => {
    const html = markdownToWordPressBlocks(
      [
        "Intro with **bold** and a [link](https://example.com).",
        "",
        "## Details",
        "",
        "- One",
        "- Two",
      ].join("\n"),
    );

    expect(html).toContain("<!-- wp:paragraph -->");
    expect(html).toContain('<p>Intro with <strong>bold</strong> and a <a href="https://example.com">link</a>.</p>');
    expect(html).toContain("<!-- /wp:paragraph -->");
    expect(html).toContain("<!-- wp:heading -->");
    expect(html).toContain("<h2>Details</h2>");
    expect(html).toContain("<!-- wp:list -->");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>One</li>");
  });

  test("converts Gutenberg block markup back to markdown", () => {
    const markdown = wordpressBlocksToMarkdown(
      [
        "<!-- wp:heading -->",
        "<h2>Details</h2>",
        "<!-- /wp:heading -->",
        "<!-- wp:paragraph -->",
        '<p>Intro with <strong>bold</strong> and a <a href="https://example.com">link</a>.</p>',
        "<!-- /wp:paragraph -->",
        '<!-- wp:list {"ordered":true} -->',
        "<ol><li>One</li><li>Two</li></ol>",
        "<!-- /wp:list -->",
      ].join("\n"),
    );

    expect(markdown).toContain("## Details");
    expect(markdown).toContain("Intro with **bold** and a [link](https://example.com).");
    expect(markdown).toContain("1. One");
    expect(markdown).toContain("2. Two");
  });
});
