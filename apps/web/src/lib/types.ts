export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; id: string; name: string; args: unknown };

export type MessageRole = "user" | "assistant" | "tool" | "custom" | "summary";

export type MessageDTO = {
  id: string;
  role: MessageRole;
  blocks: MessageBlock[];
  /** assistant 专用 */
  model?: string;
  /** tool 专用：与 toolCall block 的 id 对应 */
  toolCallId?: string;
  /** tool 专用 */
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
};

/** 界面上的一条消息：live 表示还在流式生成中 */
export type ChatItem = MessageDTO & { live?: boolean };

export type SessionSummary = {
  id: string;
  name: string | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
  model: string | null;
  thinkingLevel: ThinkingLevel;
};

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ApiType =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type CatalogModel = {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
};

export type CatalogProvider = {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  available: boolean;
  models: CatalogModel[];
};

export type RuntimeStatus = {
  configured: boolean;
  defaultModel: string | null;
  thinkingLevel: ThinkingLevel;
  error: string | null;
};

export type ModelsResponse = RuntimeStatus & { providers: CatalogProvider[] };

export type ProviderModelView = {
  id: string;
  name?: string;
  api?: ApiType;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: Record<string, unknown>;
};

export type ProviderConfigView = {
  id: string;
  name: string;
  baseUrl: string;
  api: ApiType;
  apiKeyMasked: string;
  models: ProviderModelView[];
};

export type ConfigView = {
  defaultModel: string | null;
  thinkingLevel: ThinkingLevel;
  providers: ProviderConfigView[];
};

export type HealthResponse = RuntimeStatus & {
  version: string;
  workspace: string;
  activeSessions: number;
  uptimeMs: number;
};

export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const API_TYPES: ApiType[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];
