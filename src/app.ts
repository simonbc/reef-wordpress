import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig, saveWordPressComConfig } from "./config";
import type { DocumentType, ReefDocument } from "./domain";
import { escapeHtml, markdownToHtml } from "./markdown";
import {
  buildWordPressAuthorizeUrl,
  exchangeWordPressCode,
  readOAuthState,
  saveOAuthState,
  saveWordPressToken,
  readWordPressToken,
  type WordPressOAuthConfig,
} from "./oauth";
import { createDocumentStore } from "./store";
import {
  createWordPressComClient,
  listWordPressComSites,
  type WordPressComSite,
} from "./wordpress-com";

export type App = {
  fetch(request: Request): Promise<Response>;
};

export function createApp(input: {
  root: string;
  wordpressOAuth?: WordPressOAuthConfig;
  randomState?: () => string;
  fetch?: typeof fetch;
}): App {
  return {
    fetch: (request) => handleRequest(input, request),
  };
}

async function handleRequest(
  app: {
    root: string;
    wordpressOAuth?: WordPressOAuthConfig;
    randomState?: () => string;
    fetch?: typeof fetch;
  },
  request: Request,
): Promise<Response> {
  const root = app.root;
  const url = new URL(request.url);
  const config = await loadConfig(root);

  if (request.method === "POST" && url.pathname === "/auth/wordpress/start") {
    if (!app.wordpressOAuth) {
      return htmlResponse(renderSetup("WordPress.com OAuth is not configured for this Reef app."), 400);
    }

    const state = app.randomState?.() ?? crypto.randomUUID();
    await saveOAuthState(root, state);
    return redirect(
      buildWordPressAuthorizeUrl({
        clientId: app.wordpressOAuth.clientId,
        redirectUri: callbackUrl(url),
        state,
      }),
    );
  }

  if (url.pathname === "/auth/wordpress/callback") {
    if (!app.wordpressOAuth) {
      return htmlResponse(renderLayout("Connect WordPress.com", "<p>WordPress.com OAuth is not configured.</p>"), 400);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = await readOAuthState(root);
    if (!code || !state || state !== expectedState) {
      return htmlResponse(renderLayout("Connect WordPress.com", "<p>WordPress.com authorization did not match this local session.</p>"), 400);
    }

    const accessToken = await exchangeWordPressCode({
      clientId: app.wordpressOAuth.clientId,
      clientSecret: app.wordpressOAuth.clientSecret,
      code,
      redirectUri: callbackUrl(url),
      fetch: app.fetch,
    });
    await saveWordPressToken(root, accessToken);
    const sites = await listWordPressComSites({ token: accessToken, fetch: app.fetch });
    if (sites.length === 0) {
      return htmlResponse(
        renderLayout("Connect WordPress.com", "<p>No WordPress.com sites were returned for this account.</p>"),
        400,
      );
    }
    if (sites.length === 1) {
      await saveWordPressComConfig(root, {
        title: sites[0].title,
        siteId: sites[0].id,
        siteUrl: sites[0].url,
      });
      return redirect("/");
    }

    await saveDiscoveredSites(root, sites);
    return htmlResponse(renderSitePicker(sites));
  }

  if (request.method === "POST" && url.pathname === "/auth/wordpress/site") {
    const form = await request.formData();
    const siteId = stringField(form, "site_id");
    const sites = await readDiscoveredSites(root);
    const site = sites.find((candidate) => candidate.id === siteId);
    if (!site) {
      return htmlResponse(renderLayout("Choose site", "<p>That WordPress.com site was not found in this local session.</p>"), 400);
    }
    await saveWordPressComConfig(root, {
      title: site.title,
      siteId: site.id,
      siteUrl: site.url,
    });
    return redirect("/");
  }

  if (!config.wordpressCom) {
    return htmlResponse(renderSetup());
  }

  const store = createDocumentStore(root);

  if (request.method === "POST" && url.pathname === "/documents") {
    const form = await request.formData();
    const type = stringField(form, "type") === "page" ? "page" : "post";
    const title = stringField(form, "title") || "Untitled";
    const markdown = stringField(form, "markdown");
    const document = await store.save({
      type,
      title,
      markdown,
    });
    const intent = publishIntent(form);
    if (intent) {
      const published = await syncWordPress({
        root,
        config,
        document,
        status: intent,
        fetch: app.fetch,
      });
      await store.setWordPressState(document.id, published);
    }
    return redirect(`/${type === "post" ? "posts" : "pages"}/${document.slug}`);
  }

  const updateMatch = url.pathname.match(/^\/(posts|pages)\/([^/]+)$/);
  if (request.method === "POST" && updateMatch) {
    const type = updateMatch[1] === "pages" ? "page" : "post";
    const slug = decodeURIComponent(updateMatch[2]);
    const form = await request.formData();
    const document = await store.update(`${type}:${slug}`, {
      title: stringField(form, "title") || "Untitled",
      markdown: stringField(form, "markdown"),
    });
    if (!document) {
      return htmlResponse(renderLayout(config.title, "<p>Not found.</p>"), 404);
    }
    const intent = publishIntent(form);
    if (intent) {
      const published = await syncWordPress({
        root,
        config,
        document,
        status: intent,
        fetch: app.fetch,
      });
      await store.setWordPressState(document.id, published);
    }
    return redirect(`/${type === "post" ? "posts" : "pages"}/${document.slug}`);
  }

  const deleteMatch = url.pathname.match(/^\/(posts|pages)\/([^/]+)\/delete$/);
  if (request.method === "POST" && deleteMatch) {
    const type = deleteMatch[1] === "pages" ? "page" : "post";
    const slug = decodeURIComponent(deleteMatch[2]);
    const document = await store.read(`${type}:${slug}`);
    if (!document) {
      return htmlResponse(renderLayout(config.title, "<p>Not found.</p>"), 404);
    }
    if (document.wordpress) {
      await deleteFromWordPress({
        root,
        config,
        document,
        fetch: app.fetch,
      });
    }
    const deleted = await store.delete(`${type}:${slug}`);
    if (!deleted) {
      return htmlResponse(renderLayout(config.title, "<p>Not found.</p>"), 404);
    }
    return redirect("/");
  }

  if (url.pathname === "/") {
    const [posts, pages] = await Promise.all([store.list("post"), store.list("page")]);
    return htmlResponse(renderHome({
      title: config.title,
      siteUrl: config.wordpressCom.siteUrl,
      posts,
      pages,
    }));
  }

  if (url.pathname === "/new") {
    const type = url.searchParams.get("type") === "page" ? "page" : "post";
    return htmlResponse(renderEditor({ title: config.title, type }));
  }

  const editMatch = url.pathname.match(/^\/(posts|pages)\/([^/]+)\/edit$/);
  if (editMatch) {
    const type = editMatch[1] === "pages" ? "page" : "post";
    const document = await store.read(`${type}:${decodeURIComponent(editMatch[2])}`);
    if (!document) {
      return htmlResponse(renderLayout(config.title, "<p>Not found.</p>"), 404);
    }
    return htmlResponse(renderEditor({ title: config.title, type, document }));
  }

  const contentMatch = url.pathname.match(/^\/(posts|pages)\/([^/]+)$/);
  if (contentMatch) {
    const type = contentMatch[1] === "pages" ? "page" : "post";
    const document = await store.read(`${type}:${decodeURIComponent(contentMatch[2])}`);
    if (!document) {
      return htmlResponse(renderLayout(config.title, "<p>Not found.</p>"), 404);
    }
    return htmlResponse(renderDocument(config.title, document));
  }

  return htmlResponse(renderLayout(config.title, "<p>Not found.</p>"), 404);
}

function renderSetup(error?: string): string {
  return renderLayout(
    "Connect WordPress.com",
    [
      '<main class="setup">',
      '<div class="brand">Reef</div>',
      "<h1>Connect WordPress.com</h1>",
      "<p>Start by connecting this local workspace to a WordPress.com site.</p>",
      error ? `<p class="error">${escapeHtml(error)}</p>` : "",
      '<form method="post" action="/auth/wordpress/start" class="setup-form">',
      '<button>Connect with WordPress.com</button>',
      "</form>",
      '<p class="setup-note">Reef stores the OAuth token locally under .reef/secrets, not in reef.toml.</p>',
      "</main>",
    ].join("\n"),
    { bare: true },
  );
}

function renderSitePicker(sites: WordPressComSite[]): string {
  return renderLayout(
    "Choose a WordPress.com site",
    [
      '<main class="setup">',
      '<div class="brand">Reef</div>',
      "<h1>Choose a WordPress.com site</h1>",
      "<p>Pick the site this local workspace should publish to.</p>",
      '<form method="post" action="/auth/wordpress/site" class="site-picker">',
      sites.map(renderSiteChoice).join("\n"),
      "<button>Use selected site</button>",
      "</form>",
      "</main>",
    ].join("\n"),
    { bare: true },
  );
}

function renderSiteChoice(site: WordPressComSite): string {
  return [
    '<label class="site-choice">',
    `<input type="radio" name="site_id" value="${escapeHtml(site.id)}" required>`,
    "<span>",
    `<strong>${escapeHtml(site.title)}</strong>`,
    site.url ? `<small>${escapeHtml(site.url)}</small>` : "",
    "</span>",
    "</label>",
  ].join("");
}

function renderHome(input: { title: string; siteUrl?: string; posts: ReefDocument[]; pages: ReefDocument[] }): string {
  return renderLayout(
    input.title,
    [
      '<header class="topbar">',
      '<a class="brand" href="/">Reef</a>',
      `<nav>${input.siteUrl ? `<a href="${escapeHtml(input.siteUrl)}" target="_blank" rel="noopener">View site</a>` : ""}<a href="/new?type=page">New page</a><a class="button" href="/new">Create</a></nav>`,
      "</header>",
      '<main class="home">',
      '<section class="profile">',
      `<h1>${escapeHtml(input.title)}</h1>`,
      "<p>Local writing, published through WordPress.com.</p>",
      "</section>",
      '<section class="content-tabs"><span>Posts</span><span>Pages</span><span>Media</span></section>',
      '<section class="feed">',
      input.posts.length
        ? input.posts.map(renderFeedItem).join("\n")
        : '<p class="empty">No posts yet. Create a first draft.</p>',
      "</section>",
      input.pages.length
        ? `<aside class="pages"><h2>Pages</h2>${input.pages.map(renderPageLink).join("\n")}</aside>`
        : "",
      "</main>",
    ].join("\n"),
  );
}

function renderEditor(input: { title: string; type: DocumentType; document?: ReefDocument }): string {
  const document = input.document;
  const markdown = document?.markdown ?? "";
  const action = document
    ? `/${input.type === "post" ? "posts" : "pages"}/${encodeURIComponent(document.slug)}`
    : "/documents";
  return renderLayout(
    input.title,
    [
      `<form method="post" action="${action}" class="editor-shell">`,
      '<section class="editor-pane">',
      '<div class="editor-title-row">',
      `<input class="title-input" name="title" placeholder="# Title" value="${escapeHtml(document?.title ?? "")}" data-title-editor>`,
      "</div>",
      `<input type="hidden" name="type" value="${input.type}">`,
      `<textarea name="markdown" placeholder="Write something..." data-markdown-editor>${escapeHtml(markdown)}</textarea>`,
      '<div class="editor-help">Markdown</div>',
      "</section>",
      '<section class="preview" data-markdown-preview>',
      markdown ? markdownToHtml(markdown) : '<p class="muted">Preview appears here.</p>',
      "</section>",
      '<footer class="editor-actions">',
      `<span>${input.type === "post" ? "Post" : "Page"}</span>`,
      `<span class="slug-pill">/${document?.slug ?? "set-slug"}</span>`,
      '<button type="submit">Save locally</button>',
      '<button type="submit" name="intent" value="publish-draft" class="primary">Publish draft</button>',
      '<button type="submit" name="intent" value="publish" class="primary">Publish</button>',
      '<a href="/">Cancel</a>',
      "</footer>",
      "</form>",
      editorPreviewScript(),
    ].join("\n"),
    { editor: true },
  );
}

function editorPreviewScript(): string {
  return [
    "<script>",
    "(() => {",
    "  const titleInput = document.querySelector('[data-title-editor]');",
    "  const editor = document.querySelector('[data-markdown-editor]');",
    "  const preview = document.querySelector('[data-markdown-preview]');",
    "  if (!editor || !preview) return;",
    "  const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');",
    "  const inline = (value) => escapeHtml(value)",
    "    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')",
    "    .replace(/\\*([^*]+)\\*/g, '<em>$1</em>')",
    "    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href=\"$2\">$1</a>');",
    "  function renderBlock(block) {",
    "    const trimmed = block.trim();",
    "    const heading = trimmed.match(/^(#{1,3})\\s+(.+)$/);",
    "    if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;",
    "    return `<p>${inline(trimmed).replace(/\\n/g, '<br>')}</p>`;",
    "  }",
    "  function renderMarkdown(markdown) {",
    "    const text = markdown.trim();",
    "    if (!text) return '<p class=\"muted\">Preview appears here.</p>';",
    "    return text.split(/\\n{2,}/).map(renderBlock).join('\\n');",
    "  }",
    "  function updatePreview() {",
    "    const title = titleInput && titleInput.value.trim() ? `<h1>${escapeHtml(titleInput.value.trim())}</h1>` : '';",
    "    preview.innerHTML = title + renderMarkdown(editor.value);",
    "  }",
    "  titleInput?.addEventListener('input', updatePreview);",
    "  editor.addEventListener('input', updatePreview);",
    "  updatePreview();",
    "  window.renderMarkdown = renderMarkdown;",
    "})();",
    "</script>",
  ].join("\n");
}

function renderDocument(siteTitle: string, document: ReefDocument): string {
  return renderLayout(
    siteTitle,
    [
      '<header class="topbar">',
      '<a class="brand" href="/">Reef</a>',
      '<nav><a class="button" href="/new">Create</a></nav>',
      "</header>",
      '<main class="article">',
      `<h1>${escapeHtml(document.title)}</h1>`,
      `<div class="meta">${escapeHtml(document.date)} · ${statusLabel(document)}</div>`,
      markdownToHtml(document.markdown),
      renderArticleActions(document),
      "</main>",
    ].join("\n"),
  );
}

function renderArticleActions(document: ReefDocument): string {
  const path = `/${document.type === "post" ? "posts" : "pages"}/${encodeURIComponent(document.slug)}`;
  const kind = document.type === "post" ? "post" : "page";
  const message = document.wordpress
    ? `Delete this local ${kind} and its WordPress.com ${kind}?`
    : `Delete this local ${kind}?`;
  return [
    '<div class="article-actions">',
    `<a href="${path}/edit">Edit</a>`,
    `<form method="post" action="${path}/delete" onsubmit="return confirm('${escapeHtml(message)}')">`,
    "<button>Delete</button>",
    "</form>",
    "</div>",
  ].join("");
}

function renderFeedItem(document: ReefDocument): string {
  return [
    '<article class="feed-item">',
    `<h2><a href="/posts/${encodeURIComponent(document.slug)}">${escapeHtml(document.title)}</a> ${statusLabel(document)}</h2>`,
    `<div class="meta">${escapeHtml(document.date)}</div>`,
    `<div class="excerpt">${markdownToHtml(document.markdown).slice(0, 360)}</div>`,
    "</article>",
  ].join("\n");
}

function renderPageLink(document: ReefDocument): string {
  return `<a href="/pages/${encodeURIComponent(document.slug)}">${escapeHtml(document.title)}</a>`;
}

function statusLabel(document: ReefDocument): string {
  if (document.wordpress) {
    return `<span class="status">${document.wordpress.status === "publish" ? "published" : "wp draft"}</span>`;
  }
  return `<span class="status">local</span>`;
}

function renderLayout(
  title: string,
  body: string,
  options: { bare?: boolean; editor?: boolean } = {},
): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(pageTitle(title))}</title>`,
    "<style>",
    styles(),
    "</style>",
    "</head>",
    `<body class="${options.bare ? "bare" : ""} ${options.editor ? "editor" : ""}">`,
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

function styles(): string {
  return `
:root { color-scheme: light; --paper: #f8f7f2; --ink: #222; --muted: #8f8a82; --line: #e8e4dc; --accent: #3858e9; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color: inherit; text-decoration: none; }
.topbar { height: 88px; display: flex; align-items: center; justify-content: space-between; padding: 0 44px; border-bottom: 1px solid var(--line); background: rgba(248,247,242,.88); }
.brand { color: var(--accent); font-weight: 800; font-size: 28px; }
nav { display: flex; gap: 18px; align-items: center; color: #6f6a62; }
.button, button { border: 0; border-radius: 999px; background: var(--accent); color: white; padding: 11px 18px; font: inherit; font-weight: 700; cursor: pointer; }
.home { max-width: 720px; margin: 72px auto; padding: 0 24px; }
.profile { margin-bottom: 72px; }
.profile h1 { margin: 0 0 6px; font-size: 28px; }
.profile p { margin: 0; color: #6f6a62; font-size: 18px; }
.content-tabs { display: flex; gap: 22px; margin-bottom: 28px; color: var(--muted); font-weight: 700; }
.feed-item { padding: 34px 0 38px; border-bottom: 1px solid var(--line); }
.feed-item h2 { margin: 0 0 8px; font-size: 30px; line-height: 1.1; letter-spacing: 0; }
.meta, .status { color: var(--muted); text-transform: uppercase; letter-spacing: .04em; font-size: 13px; font-weight: 700; }
.status { background: #e8e5de; border-radius: 999px; padding: 3px 8px; margin-left: 8px; text-transform: none; letter-spacing: 0; }
.excerpt { font-family: Georgia, serif; font-size: 22px; line-height: 1.55; color: #3d3832; margin-top: 16px; }
.pages { margin-top: 52px; display: grid; gap: 10px; color: #6f6a62; }
.pages h2 { margin: 0; font-size: 15px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.empty, .muted { color: var(--muted); }
.setup { max-width: 520px; margin: 18vh auto; padding: 0 24px; }
.setup .brand { margin-bottom: 48px; }
.setup h1 { font-size: 42px; margin: 0 0 10px; }
.setup p { color: #6f6a62; font-size: 18px; line-height: 1.5; }
.setup-form { display: grid; gap: 18px; margin-top: 34px; }
.setup-note { font-size: 14px !important; }
.error { color: #9f2d20 !important; }
.site-picker { display: grid; gap: 14px; margin-top: 34px; }
.site-choice { grid-template-columns: auto 1fr; align-items: center; border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 16px; }
.site-choice input { width: auto; }
.site-choice span { display: grid; gap: 4px; }
.site-choice small { color: var(--muted); font-weight: 500; }
label { display: grid; gap: 7px; color: #6f6a62; font-weight: 700; }
input, textarea { width: 100%; border: 1px solid var(--line); background: #fff; color: var(--ink); font: inherit; border-radius: 12px; padding: 13px 14px; }
.editor-shell { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 68px; background: #fff; }
.editor-pane, .preview { padding: 44px 38px; min-height: calc(100vh - 68px); }
.editor-pane { border-right: 1px solid var(--line); }
.title-input { border: 0; padding: 0; font-size: 24px; font-weight: 800; color: #aaa; outline: none; }
textarea { border: 0; padding: 34px 0; min-height: 70vh; resize: none; outline: none; font: 18px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.editor-help { color: #aaa; position: fixed; left: 38px; bottom: 23px; }
.preview { font-family: Georgia, serif; font-size: 22px; line-height: 1.62; color: #38332d; }
.preview h1, .preview h2, .preview h3 { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
.editor-actions { grid-column: 1 / -1; border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr auto auto auto auto; align-items: center; gap: 14px; padding: 0 36px; color: var(--muted); }
.slug-pill { border: 1px solid var(--line); border-radius: 999px; padding: 8px 18px; background: #fff; }
.primary { background: var(--accent); }
.article { max-width: 680px; margin: 80px auto; padding: 0 24px; font-family: Georgia, serif; font-size: 22px; line-height: 1.6; }
.article h1 { font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 42px; line-height: 1.1; }
.article-actions { margin-top: 48px; display: flex; gap: 18px; align-items: center; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 15px; color: var(--muted); }
.article-actions a { border-bottom: 1px solid var(--line); }
.article-actions form { margin: 0; }
.article-actions button { appearance: none; border: 0; background: transparent; color: var(--muted); padding: 0; border-radius: 0; border-bottom: 1px solid var(--line); font: inherit; font-weight: 400; }
@media (max-width: 800px) {
  .editor-shell { display: block; }
  .editor-pane { border-right: 0; border-bottom: 1px solid var(--line); }
  .editor-actions { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; background: #fff; min-height: 68px; }
  .topbar { padding: 0 22px; }
  .home { margin-top: 44px; }
}
`;
}

function pageTitle(title: string): string {
  return title.endsWith(" - Reef") ? title : `${title} - Reef`;
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function callbackUrl(url: URL): string {
  return `${url.origin}/auth/wordpress/callback`;
}

async function syncWordPress(input: {
  root: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  document: ReefDocument;
  status: "draft" | "publish";
  fetch?: typeof fetch;
}) {
  if (!input.config.wordpressCom) {
    throw new Error("WordPress.com is not configured.");
  }
  const token = await readWordPressToken(input.root);
  if (!token) {
    throw new Error("WordPress.com token is missing. Reconnect WordPress.com.");
  }
  const client = createWordPressComClient({
    site: input.config.wordpressCom.siteId,
    token,
    fetch: input.fetch,
  });

  const payload = {
    type: input.document.type,
    title: input.document.title,
    html: markdownToHtml(input.document.markdown),
    status: input.status,
  } as const;

  return input.document.wordpress
    ? client.update({
        ...payload,
        remoteId: input.document.wordpress.remoteId,
      })
    : client.publish(payload);
}

async function deleteFromWordPress(input: {
  root: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  document: ReefDocument;
  fetch?: typeof fetch;
}): Promise<void> {
  if (!input.config.wordpressCom) {
    throw new Error("WordPress.com is not configured.");
  }
  if (!input.document.wordpress) {
    return;
  }
  const token = await readWordPressToken(input.root);
  if (!token) {
    throw new Error("WordPress.com token is missing. Reconnect WordPress.com.");
  }
  const client = createWordPressComClient({
    site: input.config.wordpressCom.siteId,
    token,
    fetch: input.fetch,
  });
  await client.delete({
    type: input.document.type,
    remoteId: input.document.wordpress.remoteId,
  });
}

function publishIntent(form: FormData): "draft" | "publish" | null {
  const intent = stringField(form, "intent");
  if (intent === "publish-draft") {
    return "draft";
  }
  if (intent === "publish") {
    return "publish";
  }
  return null;
}

async function saveDiscoveredSites(root: string, sites: WordPressComSite[]): Promise<void> {
  const path = discoveredSitesPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ sites }, null, 2));
}

async function readDiscoveredSites(root: string): Promise<WordPressComSite[]> {
  try {
    const json = JSON.parse(await readFile(discoveredSitesPath(root), "utf8")) as Record<string, unknown>;
    return Array.isArray(json.sites) ? (json.sites as WordPressComSite[]) : [];
  } catch {
    return [];
  }
}

function discoveredSitesPath(root: string): string {
  return join(root, ".reef", "state", "wordpress-sites.json");
}
