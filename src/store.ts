import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  documentId,
  slugify,
  type DocumentType,
  type ReefDocument,
  type SaveDocumentInput,
  type WordPressState,
} from "./domain";

type DocumentStore = {
  save(input: SaveDocumentInput): Promise<ReefDocument>;
  list(type: DocumentType): Promise<ReefDocument[]>;
  read(id: string): Promise<ReefDocument | null>;
  setWordPressState(id: string, state: WordPressState): Promise<void>;
};

export function createDocumentStore(root: string): DocumentStore {
  return {
    save: (input) => saveDocument(root, input),
    list: (type) => listDocuments(root, type),
    read: (id) => readDocument(root, id),
    setWordPressState: (id, state) => setWordPressState(root, id, state),
  };
}

async function saveDocument(root: string, input: SaveDocumentInput): Promise<ReefDocument> {
  const slug = input.slug?.trim() || slugify(input.title);
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const status = input.status ?? "local-draft";
  const markdown = [
    "---",
    `title: ${input.title}`,
    `date: ${date}`,
    `status: ${status}`,
    "---",
    "",
    input.markdown,
  ].join("\n");
  const path = contentPath(root, input.type, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown);
  return {
    id: documentId(input.type, slug),
    type: input.type,
    slug,
    title: input.title,
    markdown: input.markdown,
    date,
    status,
    wordpress: (await readWordPressStates(root))[documentId(input.type, slug)],
  };
}

async function listDocuments(root: string, type: DocumentType): Promise<ReefDocument[]> {
  const dir = join(root, directoryForType(type));
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
  } catch {
    return [];
  }

  const documents = (
    await Promise.all(files.map((file) => readDocument(root, documentId(type, file.replace(/\.md$/, "")))))
  ).filter((document): document is ReefDocument => document !== null);

  return documents.sort((a, b) =>
    type === "post"
      ? b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
      : a.title.localeCompare(b.title),
  );
}

async function readDocument(root: string, id: string): Promise<ReefDocument | null> {
  const [type, ...slugParts] = id.split(":");
  if ((type !== "post" && type !== "page") || slugParts.length === 0) {
    return null;
  }

  const slug = slugParts.join(":");
  let source = "";
  try {
    source = await readFile(contentPath(root, type, slug), "utf8");
  } catch {
    return null;
  }

  const parsed = parseDocumentSource(source);
  return {
    id,
    type,
    slug,
    title: parsed.frontmatter.title ?? slug,
    markdown: parsed.body,
    date: parsed.frontmatter.date ?? "",
    status: (parsed.frontmatter.status as ReefDocument["status"]) ?? "local-draft",
    wordpress: (await readWordPressStates(root))[id],
  };
}

async function setWordPressState(
  root: string,
  id: string,
  state: WordPressState,
): Promise<void> {
  const states = await readWordPressStates(root);
  states[id] = state;
  const path = wordpressStatePath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(states, null, 2));
}

async function readWordPressStates(root: string): Promise<Record<string, WordPressState>> {
  try {
    const parsed = JSON.parse(await readFile(wordpressStatePath(root), "utf8"));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function parseDocumentSource(source: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: source.trim() };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return { frontmatter, body: match[2].trim() };
}

function contentPath(root: string, type: DocumentType, slug: string): string {
  return join(root, directoryForType(type), `${slug}.md`);
}

function directoryForType(type: DocumentType): string {
  return type === "post" ? "posts" : "pages";
}

function wordpressStatePath(root: string): string {
  return join(root, ".reef", "state", "wordpress-com.json");
}
