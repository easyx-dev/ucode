/** 跨端共享常量：模型目录与校验都从这里取值，避免前后端各写一份枚举 */

/** pi 支持的 API 类型（pi-ai 的 KnownApi 子集，够用即可） */
export const API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type ApiType = (typeof API_TYPES)[number];

/** pi-agent-core 的 ThinkingLevel */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 对外 HTTP 接口统一前缀 */
export const API_BASE_PATH = "/api/v1";
