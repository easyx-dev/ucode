/**
 * SearXNG：自建实例的 JSON 接口，无 key、无额度。
 *
 * 实例默认只开 HTML 输出，要在 `settings.yml` 的 `search.formats` 里加上 `json`
 * （公共实例出于防滥用多数关掉了，403 基本就是这个原因，所以错误里直接给提示）。
 */
import { requestJson } from "./request";
import type { SearchProvider, SearchResult } from "./types";

type SearxngResponse = {
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

/** 实例地址允许带路径前缀（反代场景），只补末尾斜杠再拼 /search */
const searchUrl = (baseUrl: string): URL =>
  new URL(`${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}search`);

export const searxngSearch = (baseUrl: string): SearchProvider => ({
  async search(query, { count, signal }) {
    const url = searchUrl(baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");

    const payload = await requestJson<SearxngResponse>(
      "SearXNG",
      url,
      { headers: { accept: "application/json" } },
      signal,
      { 403: "实例未开启 JSON 输出，settings.yml 的 search.formats 需要包含 json" },
    );

    // SearXNG 的接口没有条数参数（由实例侧引擎决定），多出来的这里裁掉
    return (payload.results ?? [])
      .slice(0, count)
      .flatMap((item): SearchResult[] =>
        item.title && item.url
          ? [{ title: item.title, url: item.url, description: item.content ?? "" }]
          : [],
      );
  },
});
