/** Tavily Search：POST JSON + `Authorization: Bearer`，结果在 `results`，摘要在 `content` */
import { requestJson } from "./request";
import type { SearchProvider, SearchResult } from "./types";

const ENDPOINT = "https://api.tavily.com/search";

type TavilyResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

export const tavilySearch = (apiKey: string): SearchProvider => ({
  async search(query, { count, signal }) {
    const payload = await requestJson<TavilyResponse>(
      "Tavily",
      ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: count }),
      },
      signal,
    );

    return (payload.results ?? []).flatMap((item): SearchResult[] =>
      item.title && item.url
        ? [{ title: item.title, url: item.url, description: item.content ?? "" }]
        : [],
    );
  },
});
