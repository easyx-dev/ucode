/** 跨端共享常量：模型目录与校验都从这里取值，避免前后端各写一份枚举 */

/** pi 支持的 API 类型（与 pi-ai 的 KnownApi 对齐，pi 的供应商目录里都会出现） */
export const API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
  "openai-codex-responses",
  "bedrock-converse-stream",
  "google-vertex",
  "pi-messages",
] as const;

export type ApiType = (typeof API_TYPES)[number];

/** pi-agent-core 的 ThinkingLevel */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 消息角色；响应用枚举，与 pi 的 AgentMessage 角色对齐（system 等内部角色不下发） */
export const MESSAGE_ROLES = ["user", "assistant", "tool", "custom", "summary"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** 接口版本；破坏性变更时递增，路径前缀与 health 的 apiVersion 都取自它 */
export const API_VERSION = "v1";

/** 对外 HTTP 接口统一前缀 */
export const API_BASE_PATH = `/api/${API_VERSION}`;
