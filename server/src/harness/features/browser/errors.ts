/**
 * 浏览器工具的统一错误模型。
 *
 * 两条约束来自源方案：失败必须给出「为什么 + 怎么办」，且要有一个**信号位**告诉模型
 * 「ref 已失效，该重新快照而不是重试同一个 ref」。工具失败走 throw，pi 只把 `message`
 * 交给模型，所以提示与信号位都写进 message 本身（`staleRefs` 字段留给本进程的日志与测试）。
 */

export const BROWSER_ERROR_CODES = [
  "browser_not_installed",
  "browser_not_open",
  "browser_limit",
  "ref_not_found",
  "stale_ref",
  "element_obstructed",
  "navigation_failed",
  "blocked_target",
  "attach_failed",
  "action_failed",
  "browser_profile_invalid",
  "browser_profile_in_use",
] as const;

export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[number];

/** 这几个码意味着「编号表已过期」：模型看到 staleRefs 就该重新 browser_snapshot */
const STALE_CODES: ReadonlySet<BrowserErrorCode> = new Set(["ref_not_found", "stale_ref"]);

export type BrowserErrorOptions = {
  /** 怎么办：会拼进 message，模型只看得到 message */
  hint?: string;
  cause?: unknown;
};

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;
  readonly hint: string;
  readonly staleRefs: boolean;

  constructor(code: BrowserErrorCode, message: string, options: BrowserErrorOptions = {}) {
    const hint = options.hint ?? "";
    super(
      hint ? `${message}；${hint}` : message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "BrowserError";
    this.code = code;
    this.hint = hint;
    this.staleRefs = STALE_CODES.has(code);
  }
}

export const browserError = (
  code: BrowserErrorCode,
  message: string,
  options?: BrowserErrorOptions,
): BrowserError => new BrowserError(code, message, options);

export const isBrowserError = (value: unknown): value is BrowserError =>
  value instanceof BrowserError;

/**
 * 把任意异常折成给模型的失败说明。Playwright 的超时文案又长又带调用栈线索，
 * 只保留首行并补上「超时即失败、不自动等待」这条口径，避免模型把超时当成偶发而原地重试。
 */
export const toBrowserError = (error: unknown, context: string): BrowserError => {
  if (isBrowserError(error)) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const first = raw.split("\n")[0]?.trim() ?? raw;
  const hint = /timeout/i.test(first)
    ? "动作超时即失败，本工具不做自动重试；请先重新 browser_snapshot 确认页面状态"
    : "确认页面状态与入参后重试，或换一个更具体的 ref";
  return browserError("action_failed", `${context}失败：${first}`, { hint, cause: error });
};
