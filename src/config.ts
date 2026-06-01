import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ReefConfig = {
  title: string;
  wordpressCom: {
    siteId: string;
    siteUrl?: string;
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
  const siteId =
    (wordpressSection ? readTomlString(wordpressSection, "site_id") : null) ??
    (wordpressSection ? readTomlString(wordpressSection, "site") : null);
  const siteUrl = wordpressSection ? readTomlString(wordpressSection, "site_url") : null;

  return {
    title,
    wordpressCom: siteId ? { siteId, ...(siteUrl ? { siteUrl } : {}) } : null,
  };
}

export async function isConfigured(root: string): Promise<boolean> {
  return (await loadConfig(root)).wordpressCom !== null;
}

export async function saveWordPressComConfig(
  root: string,
  input: { title: string; siteId: string; siteUrl?: string },
): Promise<void> {
  const lines = [
    `title = ${tomlString(input.title.trim() || "Reef")}`,
    "",
    "[wordpress_com]",
    `site_id = ${tomlString(input.siteId.trim())}`,
  ];
  if (input.siteUrl?.trim()) {
    lines.push(`site_url = ${tomlString(input.siteUrl.trim())}`);
  }
  lines.push("");
  const source = lines.join("\n");
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
