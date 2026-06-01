# Reef WordPress Prototype

WordPress.com-first local publishing runtime.

This prototype explores Reef as a calm local writing and publishing surface on
top of WordPress.com. It is inspired by Jottit's minimal editor and reading
surface, but keeps WordPress-specific primitives explicit where they matter:
posts, pages, media, local drafts, remote publish state, and update operations.

## Start

```sh
bun run start
```

For WordPress.com OAuth, provide an app client id and secret:

```sh
export REEF_WORDPRESS_COM_CLIENT_ID="..."
export REEF_WORDPRESS_COM_CLIENT_SECRET="..."
bun run start
```

Or put them in `.env`:

```sh
REEF_WORDPRESS_COM_CLIENT_ID=...
REEF_WORDPRESS_COM_CLIENT_SECRET=...
```

The local OAuth callback URL is:

```text
http://localhost:3000/auth/wordpress/callback
```

Project settings are stored in `reef.toml`. OAuth tokens are stored locally under
`.reef/secrets/` and should not be committed.

After OAuth, Reef asks WordPress.com for the sites available to the account. If
there is one site it is selected automatically; if there are multiple, Reef shows
a small site picker.
