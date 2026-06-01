import type { DocumentType, WordPressState } from "./domain";

export type WordPressComSite = {
  id: string;
  title: string;
  url: string;
};

type WordPressComClient = {
  publish(input: {
    type: DocumentType;
    title: string;
    html: string;
    status: "draft" | "publish";
  }): Promise<WordPressState>;
  update(input: {
    type: DocumentType;
    remoteId: number;
    title: string;
    html: string;
    status: "draft" | "publish";
  }): Promise<WordPressState>;
  delete(input: {
    type: DocumentType;
    remoteId: number;
  }): Promise<void>;
};

export function createWordPressComClient(input: {
  site: string;
  token: string;
  fetch?: typeof fetch;
}): WordPressComClient {
  const runFetch = input.fetch ?? fetch;
  const baseUrl = `https://public-api.wordpress.com/wp/v2/sites/${encodeURIComponent(input.site)}`;

  return {
    publish: async (document) => {
      const response = await runFetch(`${baseUrl}/${collection(document.type)}`, {
        method: "POST",
        headers: headers(input.token),
        body: JSON.stringify({
          title: document.title,
          content: document.html,
          status: document.status,
        }),
      });
      return parseResult(response);
    },
    update: async (document) => {
      const response = await runFetch(`${baseUrl}/${collection(document.type)}/${document.remoteId}`, {
        method: "POST",
        headers: headers(input.token),
        body: JSON.stringify({
          title: document.title,
          content: document.html,
          status: document.status,
        }),
      });
      return parseResult(response);
    },
    delete: async (document) => {
      const response = await runFetch(`${baseUrl}/${collection(document.type)}/${document.remoteId}`, {
        method: "DELETE",
        headers: headers(input.token),
      });
      if (!response.ok) {
        throw new Error(`WordPress.com delete failed: ${response.status} ${response.statusText}`);
      }
    },
  };
}

export async function listWordPressComSites(input: {
  token: string;
  fetch?: typeof fetch;
}): Promise<WordPressComSite[]> {
  const response = await (input.fetch ?? fetch)(
    "https://public-api.wordpress.com/rest/v1.1/me/sites",
    {
      headers: {
        authorization: `Bearer ${input.token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`WordPress.com sites request failed: ${response.status}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const sites = Array.isArray(json.sites) ? json.sites : [];
  return sites.flatMap((site) => {
    if (!site || typeof site !== "object") {
      return [];
    }
    const record = site as Record<string, unknown>;
    const id = typeof record.ID === "number" || typeof record.ID === "string" ? String(record.ID) : "";
    const title =
      typeof record.name === "string"
        ? record.name
        : typeof record.title === "string"
          ? record.title
          : id;
    const url = typeof record.URL === "string" ? record.URL : typeof record.url === "string" ? record.url : "";
    return id ? [{ id, title, url }] : [];
  });
}

function collection(type: DocumentType): string {
  return type === "post" ? "posts" : "pages";
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function parseResult(response: Response): Promise<WordPressState> {
  if (!response.ok) {
    throw new Error(`WordPress.com request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const remoteId = typeof json.id === "number" ? json.id : Number(json.id);
  if (!Number.isInteger(remoteId)) {
    throw new Error("WordPress.com response did not include a numeric id.");
  }

  return {
    remoteId,
    url: typeof json.link === "string" ? json.link : "",
    status: json.status === "publish" ? "publish" : "draft",
  };
}
