import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadDotEnv(
  root: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  let source = "";
  try {
    source = await readFile(join(root, ".env"), "utf8");
  } catch {
    return;
  }

  for (const line of source.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || env[parsed.key] !== undefined) {
      continue;
    }
    env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separator).trim();
  const rawValue = trimmed.slice(separator + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  return { key, value: unquote(rawValue) };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
