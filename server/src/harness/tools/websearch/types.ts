/** 联网搜索的 provider 抽象：各服务商只差端点、鉴权与响应映射 */

export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

export type SearchOptions = {
  /** 期望条数，provider 侧自行钳到自己的上限 */
  count: number;
  /** 会话中断信号：连同自身超时一起传给 fetch */
  signal?: AbortSignal;
};

export type SearchProvider = {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
};
