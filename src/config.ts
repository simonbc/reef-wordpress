import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ReefConfig = {
  title: string;
  wordpressCom: {
    site: string;
    tokenEnv: string;
  } | null;
};

export async function loadConfig(root: string): Promise<ReefConfig> {
  let source = "";
  try {
    source = await readFile(join(root, "reef.toml"), "utf8");
  } catch {
    return { title: "Reef", wordpressCom: null };
  }

  const title = readTomlString(source, "title") ?? "Reef";
  const wordpressSection = readSection(source, "wordpress_com");
  const site = wordpressSection ? readTomlString(wordpressSection, "site") : null;
  const tokenEnv =
    (wordpressSection ? readTomlString(wordpressSection, "token_env") : null) ??
    "REEF_WORDPRESS_COM_TOKEN";

  return {
    title,
    wordpressCom: site ? { site, tokenEnv } : null,
  };
}

export async function isConfigured(root: string): Promise<boolean> {
  return (await loadConfig(root)).wordpressCom !== null;
}

export async function saveWordPressComConfig(
  root: string,
  input: { title: string; site: string; tokenEnv?: string },
): Promise<void> {
  const tokenEnv = input.tokenEnv?.trim() || "REEF_WORDPRESS_COM_TOKEN";
  const source = [
    `title = ${tomlString(input.title.trim() || "Reef")}`,
    "",
    "[wordpress_com]",
    `site = ${tomlString(input.site.trim())}`,
    `token_env = ${tomlString(tokenEnv)}`,
    "",
  ].join("\n");
  const path = join(root, "reef.toml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

function readSection(source: string, name: string): string | null {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start === -1) {
    return null;
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[.+\]\s*$/.test(line)) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join("\n");
}

function readTomlString(source: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]*)"\\s*$`, "m"));
  return match ? match[1] : null;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
