/** Brave Web Search：GET + `X-Subscription-Token` 头，结果在 `web.results` */
import { requestJson } from "./request";
import type { SearchProvider, SearchResult } from "./types";

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

type BraveResponse = {
  web?: {
    results?: Array<{ title?: string; url?: string; description?: string }>;
  };
};

export const braveSearch = (apiKey: string): SearchProvider => ({
  async search(query, { count, signal }) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    const payload = await requestJson<BraveResponse>(
      "Brave",
      url,
      {
        headers: { accept: "application/json", "x-subscription-token": apiKey },
      },
      signal,
    );

    return (payload.web?.results ?? []).flatMap((item): SearchResult[] =>
      item.title && item.url
        ? [{ title: item.title, url: item.url, description: item.description ?? "" }]
        : [],
    );
  },
});
