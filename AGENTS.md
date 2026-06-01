# Reef WordPress Agent Guide

This repository is a clean prototype for a WordPress.com-first version of Reef.
It intentionally starts over from the earlier `/Users/simoncarstensen/code/reef`
codebase, but the old repo may be used as a reference shelf for proven ideas:
markdown parsing, local workspace conventions, config loading, server startup,
agent-operable commands, mocked WordPress tests, and publish/update state.

## Product Thesis

Reef is a local writing and publishing surface on top of WordPress.com.

It should not compete with wp-admin as "a simpler admin screen." If Reef feels
like wp-admin, it is probably wrong. Reef should feel more like a calm personal
publishing tool: local-first, markdown-native, browser-based, agent-friendly,
and publish/sync-aware.

Useful distinction:

- WordPress.com is the public site, storage, identity, hosting, and publishing
  backend.
- Reef is the local writing, editing, preview, operation, and agent layer.

## Product Boundary

Start with WordPress.com only.

Do not add:

- GitHub Pages
- Mastodon
- Bluesky
- generic provider abstractions
- static site builds
- themes as a core concern
- self-hosted WordPress support

Those may return later, but this prototype should first answer whether a
WordPress.com-backed Reef feels useful.

## Primary Workflow

1. User enters a working directory.
2. User runs `reef`.
3. Reef starts a local server.
4. Reef opens the system browser to the local server.
5. If `reef.toml` is missing or WordPress.com is not configured, the first screen
   is a WordPress.com connection flow.
6. Once configured, Reef opens a writing-first UI for creating, editing,
   previewing, publishing, updating, and syncing posts/pages/media.

The working directory is the user's local project. Keep it inspectable and
git-friendly.

## First-Run Flow

If `reef.toml` does not exist, or `[wordpress_com].site` is missing, the UI
should show a setup screen before the writing UI.

The setup screen should ask for:

- site title
- WordPress.com site, e.g. `example.wordpress.com`

The setup action starts WordPress.com OAuth and writes `reef.toml`.

Do not ask for the actual token in the UI. OAuth tokens are written to
`.reef/secrets/wordpress-com.json` for the prototype. A later version can use the
OS keychain.

## Config

Project settings live in `reef.toml`.

Store non-secret WordPress.com settings there:

```toml
title = "My Site"

[wordpress_com]
site = "example.wordpress.com"
```

Do not store WordPress.com tokens in `reef.toml`.

The local app needs WordPress.com OAuth app credentials from environment
variables:

```sh
REEF_WORDPRESS_COM_CLIENT_ID
REEF_WORDPRESS_COM_CLIENT_SECRET
```

The local OAuth callback URL is:

```text
http://localhost:3000/auth/wordpress/callback
```

## Local Source Model

Markdown is canonical local source.

Target workspace shape:

```text
posts/
pages/
media/
reef.toml
.reef/
  state/
  cache/
  operations/
```

Posts are chronological writing entries.

Pages are stable site resources such as about/contact/project pages.

Media contains files used by posts/pages.

WordPress.com publish/update state lives under `.reef/state`, not inside the
markdown body. Local source should stay portable and readable.

## Content State

Model documents as local documents with optional WordPress.com state attached:

```text
Document
  id
  type: post | page
  title
  slug
  markdown
  html preview
  local status
  wordpress.com remote id/url/status, if published
```

Useful statuses:

- local draft
- WordPress draft
- published
- changed locally
- remote changed
- conflict

Do not implement magical bidirectional sync early. Prefer explicit operations:

- create local draft
- publish to WordPress.com draft
- update WordPress.com
- pull from WordPress.com
- show diff

## UI Direction

The UI should take inspiration from Jottit, not wp-admin.

It should feel:

- calm
- minimal
- writing-first
- readable
- direct
- personal

It should not feel:

- dashboard-heavy
- admin-heavy
- enterprise CMS-like
- form-grid-heavy
- like a clone of wp-admin

Default configured home:

- simple top bar
- site/profile header
- readable feed of posts
- tabs or quiet controls for posts/pages/media
- obvious `Create` action
- subtle local/WordPress status labels

Create/edit screen:

- left: markdown editor
- right: live preview
- bottom/status area: type, slug, save state, WordPress.com state, publish/update
  controls

Media and settings may exist, but should not dominate the first screen.

## Agent Layer

Agents are optional power users, not the only product surface.

Two usage modes should remain compatible:

1. Direct app mode: user runs `reef`, opens browser UI, writes/publishes there.
2. Agent harness mode: user runs Codex/Claude in the working directory and asks
   the agent to manipulate the same local source and Reef operations.

The future prompt box inside Reef should operate on local source first and
produce drafts/proposals/diffs before publishing.

Agent-generated content should default to local drafts or WordPress.com drafts.
Do not publish live without explicit user intent.

## WordPress.com Scope

Use WordPress.com APIs only in this prototype.

Expected early capabilities:

- configure a WordPress.com site
- connect WordPress.com via OAuth
- create/list/edit local posts
- create/list/edit local pages
- store media locally
- publish a local post/page to WordPress.com draft
- update a previously published WordPress.com post/page
- record remote id/url/status in `.reef/state`

Network behavior must be behind small functions and mocked in tests. Do not hit
real WordPress.com endpoints in unit tests.

## Development Discipline

Use TDD red/green for behavior changes.

For each behavior change:

1. Write or update a focused test first.
2. Run the test and confirm it fails for the expected reason.
3. Implement the smallest change that makes it pass.
4. Run the focused test again.
5. Run `bun run check` before committing.

Keep tests behavior-focused.

## Commands

Expected commands:

```sh
bun test
bun run check
bun run start
```

The eventual CLI command is:

```sh
reef
```

It should start the local server and open the system browser.

## Implementation Bias

Prefer:

- boring TypeScript
- Bun runtime primitives
- small modules
- file-backed state before databases
- markdown as source
- explicit WordPress.com operations
- tests before behavior changes

Avoid:

- large frontend frameworks until needed
- premature provider abstraction
- hidden publishing side effects
- storing secrets in project files
- adding static-site concerns
- copying old Reef code without checking whether it fits this product
