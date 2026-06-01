import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type WordPressOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export function buildWordPressAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  site?: string;
  state: string;
}): string {
  const url = new URL("https://public-api.wordpress.com/oauth2/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  if (input.site) {
    url.searchParams.set("blog", input.site);
  }
  url.searchParams.set("scope", "global");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeWordPressCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: typeof fetch;
}): Promise<string> {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);
  body.set("client_secret", input.clientSecret);
  body.set("code", input.code);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", input.redirectUri);

  const response = await (input.fetch ?? fetch)("https://public-api.wordpress.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`WordPress.com OAuth token exchange failed: ${response.status}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string" || json.access_token.trim() === "") {
    throw new Error("WordPress.com OAuth response did not include an access token.");
  }
  return json.access_token;
}

export async function saveOAuthState(root: string, state: string): Promise<void> {
  await writeJson(oauthStatePath(root), { state });
}

export async function readOAuthState(root: string): Promise<string | null> {
  try {
    const json = JSON.parse(await readFile(oauthStatePath(root), "utf8")) as Record<string, unknown>;
    return typeof json.state === "string" ? json.state : null;
  } catch {
    return null;
  }
}

export async function saveWordPressToken(root: string, accessToken: string): Promise<void> {
  await writeJson(wordpressTokenPath(root), { accessToken });
}

export async function readWordPressToken(root: string): Promise<string | null> {
  try {
    const json = JSON.parse(await readFile(wordpressTokenPath(root), "utf8")) as Record<string, unknown>;
    return typeof json.accessToken === "string" ? json.accessToken : null;
  } catch {
    return null;
  }
}

function oauthStatePath(root: string): string {
  return join(root, ".reef", "state", "oauth-state.json");
}

function wordpressTokenPath(root: string): string {
  return join(root, ".reef", "secrets", "wordpress-com.json");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}
