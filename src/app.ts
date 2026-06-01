import { loadConfig, saveWordPressComConfig } from "./config";
import type { DocumentType, ReefDocument } from "./domain";
import { escapeHtml, markdownToHtml } from "./markdown";
import {
  buildWordPressAuthorizeUrl,
  exchangeWordPressCode,
  readOAuthState,
  saveOAuthState,
  saveWordPressToken,
  type WordPressOAuthConfig,
} from "./oauth";
import { createDocumentStore } from "./store";

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

    const form = await request.formData();
    const site = stringField(form, "site");
    await saveWordPressComConfig(root, {
      title: stringField(form, "title") || "Reef",
      site,
    });
    const state = app.randomState?.() ?? crypto.randomUUID();
    await saveOAuthState(root, state);
    return redirect(
      buildWordPressAuthorizeUrl({
        clientId: app.wordpressOAuth.clientId,
        redirectUri: callbackUrl(url),
        site,
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
    return redirect("/");
  }

  if (request.method === "POST" && url.pathname === "/setup") {
    const form = await request.formData();
    await saveWordPressComConfig(root, {
      title: stringField(form, "title") || "Reef",
      site: stringField(form, "site"),
      tokenEnv: stringField(form, "token_env") || "REEF_WORDPRESS_COM_TOKEN",
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
    const document = await store.save({
      type,
      title: stringField(form, "title") || "Untitled",
      markdown: stringField(form, "markdown"),
    });
    return redirect(`/${type === "post" ? "posts" : "pages"}/${document.slug}`);
  }

  if (url.pathname === "/") {
    const [posts, pages] = await Promise.all([store.list("post"), store.list("page")]);
    return htmlResponse(renderHome({ title: config.title, posts, pages }));
  }

  if (url.pathname === "/new") {
    const type = url.searchParams.get("type") === "page" ? "page" : "post";
    return htmlResponse(renderEditor({ title: config.title, type }));
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
      '<label>Site title<input name="title" placeholder="My Site"></label>',
      '<label>WordPress.com site<input name="site" placeholder="example.wordpress.com" required></label>',
      '<button>Connect with WordPress.com</button>',
      "</form>",
      '<p class="setup-note">Reef stores the OAuth token locally under .reef/secrets, not in reef.toml.</p>',
      "</main>",
    ].join("\n"),
    { bare: true },
  );
}

function renderHome(input: { title: string; posts: ReefDocument[]; pages: ReefDocument[] }): string {
  return renderLayout(
    input.title,
    [
      '<header class="topbar">',
      '<a class="brand" href="/">Reef</a>',
      '<nav><a href="/new?type=page">New page</a><a class="button" href="/new">Create</a></nav>',
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
  return renderLayout(
    input.title,
    [
      '<form method="post" action="/documents" class="editor-shell">',
      '<section class="editor-pane">',
      '<div class="editor-title-row">',
      `<input class="title-input" name="title" placeholder="# Title" value="${escapeHtml(document?.title ?? "")}">`,
      "</div>",
      `<input type="hidden" name="type" value="${input.type}">`,
      `<textarea name="markdown" placeholder="Write something...">${escapeHtml(markdown)}</textarea>`,
      '<div class="editor-help">Markdown</div>',
      "</section>",
      '<section class="preview">',
      markdown ? markdownToHtml(markdown) : '<p class="muted">Preview appears here.</p>',
      "</section>",
      '<footer class="editor-actions">',
      `<span>${input.type === "post" ? "Post" : "Page"}</span>`,
      '<span class="slug-pill">/set-slug</span>',
      '<button type="submit">Save locally</button>',
      '<button type="button" class="primary">Publish draft</button>',
      '<a href="/">Cancel</a>',
      "</footer>",
      "</form>",
    ].join("\n"),
    { editor: true },
  );
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
      "</main>",
    ].join("\n"),
  );
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
    `<title>${escapeHtml(title)}</title>`,
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
:root { color-scheme: light; --paper: #f8f7f2; --ink: #222; --muted: #8f8a82; --line: #e8e4dc; --green: #15805f; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color: inherit; text-decoration: none; }
.topbar { height: 88px; display: flex; align-items: center; justify-content: space-between; padding: 0 44px; border-bottom: 1px solid var(--line); background: rgba(248,247,242,.88); }
.brand { color: var(--green); font-weight: 800; font-size: 28px; }
nav { display: flex; gap: 18px; align-items: center; color: #6f6a62; }
.button, button { border: 0; border-radius: 999px; background: var(--green); color: white; padding: 11px 18px; font: inherit; font-weight: 700; cursor: pointer; }
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
.primary { background: var(--green); }
.article { max-width: 680px; margin: 80px auto; padding: 0 24px; font-family: Georgia, serif; font-size: 22px; line-height: 1.6; }
.article h1 { font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 42px; line-height: 1.1; }
@media (max-width: 800px) {
  .editor-shell { display: block; }
  .editor-pane { border-right: 0; border-bottom: 1px solid var(--line); }
  .editor-actions { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; background: #fff; min-height: 68px; }
  .topbar { padding: 0 22px; }
  .home { margin-top: 44px; }
}
`;
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
