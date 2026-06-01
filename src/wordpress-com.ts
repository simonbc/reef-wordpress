import type { DocumentType, WordPressState } from "./domain";

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
  };
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
