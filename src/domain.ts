export type DocumentType = "post" | "page";

export type LocalStatus = "local-draft" | "wordpress-draft" | "published" | "changed-locally";

export type WordPressState = {
  remoteId: number;
  url: string;
  status: "draft" | "publish";
};

export type ReefDocument = {
  id: string;
  type: DocumentType;
  slug: string;
  title: string;
  markdown: string;
  date: string;
  status: LocalStatus;
  wordpress?: WordPressState;
};

export type SaveDocumentInput = {
  type: DocumentType;
  title: string;
  markdown: string;
  slug?: string;
  date?: string;
  status?: LocalStatus;
};

export function documentId(type: DocumentType, slug: string): string {
  return `${type}:${slug}`;
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}
