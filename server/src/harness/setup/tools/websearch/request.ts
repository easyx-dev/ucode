/** 搜索 provider 共用的取 JSON：带超时、把上游失败翻成可读的中文错误 */
import { WEBSEARCH_TIMEOUT_MS } from "../../../../constants/tools";

export const requestJson = async <T>(
  /** 服务商名，只用于错误文案 */
  provider: string,
  input: string | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
  /** 特定状态码的补充提示，把「上游配置没开」这类限制说清楚（如 SearXNG 的 403） */
  statusHints?: Record<number, string>,
): Promise<T> => {
  const timeout = AbortSignal.timeout(WEBSEARCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    throw new Error(
      `${provider} 搜索请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    const hint = statusHints?.[response.status];
    throw new Error(
      `${provider} 搜索返回 HTTP ${response.status}${hint ? `（${hint}）` : ""}：${text.slice(0, 300)}`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${provider} 搜索返回的不是合法 JSON`);
  }
};
