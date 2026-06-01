import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { escapeHtml } from "./markdown";

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  depth?: number;
  url?: string;
  ordered?: boolean;
  lang?: string;
  alt?: string;
};

type MdRoot = {
  type: "root";
  children: MdNode[];
};

export function markdownToWordPressBlocks(markdown: string): string {
  const tree = unified().use(remarkParse).parse(markdown) as MdRoot;
  return tree.children.map(markdownNodeToBlock).filter(Boolean).join("\n\n");
}

export function wordpressBlocksToMarkdown(html: string): string {
  const children: MdNode[] = [];
  const blockPattern = /<!--\s+wp:([a-z0-9-\/]+)(?:\s+({.*?}))?\s+-->([\s\S]*?)<!--\s+\/wp:\1\s+-->/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = blockPattern.exec(html))) {
    const before = html.slice(lastIndex, match.index).trim();
    if (before) {
      children.push({ type: "html", value: before });
    }
    children.push(wordPressBlockToMarkdownNode(match[1], parseBlockAttrs(match[2]), match[3].trim()));
    lastIndex = blockPattern.lastIndex;
  }

  const after = html.slice(lastIndex).trim();
  if (after) {
    children.push(htmlFallbackToMarkdownNode(after));
  }

  const markdown = unified()
    .use(remarkStringify, {
      bullet: "-",
      fences: true,
    })
    .stringify({ type: "root", children } as never);
  return String(markdown).trimEnd();
}

function markdownNodeToBlock(node: MdNode): string {
  switch (node.type) {
    case "paragraph":
      return block("paragraph", `<p>${renderInlineChildren(node.children)}</p>`);
    case "heading":
      return headingBlock(node);
    case "list":
      return listBlock(node);
    case "blockquote":
      return block("quote", `<blockquote>${renderChildrenAsParagraphs(node.children)}</blockquote>`);
    case "code":
      return block("code", `<pre><code>${escapeHtml(node.value ?? "")}</code></pre>`);
    case "thematicBreak":
      return "<!-- wp:separator -->\n<hr class=\"wp-block-separator has-alpha-channel-opacity\"/>\n<!-- /wp:separator -->";
    case "html":
      return block("html", node.value ?? "");
    default:
      return "";
  }
}

function headingBlock(node: MdNode): string {
  const level = node.depth ?? 2;
  const attrs = level === 2 ? "" : ` ${JSON.stringify({ level })}`;
  return block(`heading${attrs}`, `<h${level}>${renderInlineChildren(node.children)}</h${level}>`);
}

function listBlock(node: MdNode): string {
  const ordered = Boolean(node.ordered);
  const tag = ordered ? "ol" : "ul";
  const attrs = ordered ? ` ${JSON.stringify({ ordered: true })}` : "";
  const items = (node.children ?? []).map((item) => `<li>${renderListItem(item)}</li>`).join("");
  return block(`list${attrs}`, `<${tag}>${items}</${tag}>`);
}

function block(nameAndAttrs: string, html: string): string {
  const name = nameAndAttrs.includes(" ") ? nameAndAttrs : nameAndAttrs;
  const closingName = name.split(" ")[0];
  return `<!-- wp:${name} -->\n${html}\n<!-- /wp:${closingName} -->`;
}

function renderInlineChildren(children: MdNode[] = []): string {
  return children.map(renderInlineNode).join("");
}

function renderInlineNode(node: MdNode): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value ?? "");
    case "strong":
      return `<strong>${renderInlineChildren(node.children)}</strong>`;
    case "emphasis":
      return `<em>${renderInlineChildren(node.children)}</em>`;
    case "link":
      return `<a href="${escapeHtml(node.url ?? "")}">${renderInlineChildren(node.children)}</a>`;
    case "inlineCode":
      return `<code>${escapeHtml(node.value ?? "")}</code>`;
    case "break":
      return "<br>";
    case "image":
      return `<img src="${escapeHtml(node.url ?? "")}" alt="${escapeHtml(node.alt ?? "")}">`;
    default:
      return renderInlineChildren(node.children);
  }
}

function renderChildrenAsParagraphs(children: MdNode[] = []): string {
  return children.map((child) => {
    if (child.type === "paragraph") {
      return `<p>${renderInlineChildren(child.children)}</p>`;
    }
    return markdownNodeToBlock(child);
  }).join("");
}

function renderListItem(item: MdNode): string {
  return (item.children ?? []).map((child) => {
    if (child.type === "paragraph") {
      return renderInlineChildren(child.children);
    }
    return markdownNodeToBlock(child);
  }).join("");
}

function wordPressBlockToMarkdownNode(name: string, attrs: Record<string, unknown>, html: string): MdNode {
  switch (name) {
    case "paragraph":
      return { type: "paragraph", children: parseInlineHtml(stripTag(html, "p")) };
    case "heading":
      return {
        type: "heading",
        depth: Number(attrs.level ?? headingLevel(html) ?? 2),
        children: parseInlineHtml(stripHeading(html)),
      };
    case "list":
      return parseListBlock(html, Boolean(attrs.ordered));
    case "quote":
      return { type: "blockquote", children: parseParagraphs(stripOuterTag(html, "blockquote")) };
    case "code":
      return { type: "code", value: decodeHtml(stripTag(stripOuterTag(html, "pre"), "code")) };
    case "separator":
      return { type: "thematicBreak" };
    case "html":
      return { type: "html", value: html };
    default:
      return { type: "html", value: `<!-- wp:${name} -->\n${html}\n<!-- /wp:${name} -->` };
  }
}

function parseBlockAttrs(json: string | undefined): Record<string, unknown> {
  if (!json) {
    return {};
  }
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseListBlock(html: string, ordered: boolean): MdNode {
  const itemPattern = /<li>([\s\S]*?)<\/li>/g;
  const children: MdNode[] = [];
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(html))) {
    children.push({
      type: "listItem",
      children: [{ type: "paragraph", children: parseInlineHtml(match[1]) }],
    });
  }
  return { type: "list", ordered, children };
}

function parseParagraphs(html: string): MdNode[] {
  const paragraphPattern = /<p>([\s\S]*?)<\/p>/g;
  const children: MdNode[] = [];
  let match: RegExpExecArray | null;
  while ((match = paragraphPattern.exec(html))) {
    children.push({ type: "paragraph", children: parseInlineHtml(match[1]) });
  }
  return children.length ? children : [{ type: "paragraph", children: parseInlineHtml(html) }];
}

function parseInlineHtml(html: string): MdNode[] {
  let markdown = decodeHtml(html)
    .replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/g, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
    .replace(/<i>([\s\S]*?)<\/i>/g, "*$1*")
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, "[$2]($1)")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "");
  markdown = markdown.trim();
  const parsed = unified().use(remarkParse).parse(markdown) as MdRoot;
  const first = parsed.children[0];
  return first?.type === "paragraph" ? first.children ?? [] : [{ type: "text", value: markdown }];
}

function htmlFallbackToMarkdownNode(html: string): MdNode {
  if (html.startsWith("<p>")) {
    return { type: "paragraph", children: parseInlineHtml(stripTag(html, "p")) };
  }
  return { type: "html", value: html };
}

function stripTag(html: string, tag: string): string {
  return html.replace(new RegExp(`^<${tag}[^>]*>`), "").replace(new RegExp(`</${tag}>$`), "");
}

function stripOuterTag(html: string, tag: string): string {
  return stripTag(html.trim(), tag);
}

function headingLevel(html: string): number | null {
  const match = html.match(/^<h([1-6])[\s>]/);
  return match ? Number(match[1]) : null;
}

function stripHeading(html: string): string {
  return html.replace(/^<h[1-6][^>]*>/, "").replace(/<\/h[1-6]>$/, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
