/** 应用配置（provider / 模型 / 默认值）的 zod 模型 */
import { z } from "zod";

/** pi 支持的 API 类型（pi-ai 的 KnownApi 子集，够用即可） */
export const API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

/** pi-agent-core 的 ThinkingLevel */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const modelCostSchema = z.object({
  input: z.number().nonnegative().default(0),
  output: z.number().nonnegative().default(0),
  cacheRead: z.number().nonnegative().default(0),
  cacheWrite: z.number().nonnegative().default(0),
});

export const providerModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  api: z.enum(API_TYPES).optional(),
  reasoning: z.boolean().default(false),
  input: z
    .array(z.enum(["text", "image"]))
    .min(1)
    .default(["text"]),
  contextWindow: z.number().int().positive().default(128000),
  maxTokens: z.number().int().positive().default(8192),
  cost: modelCostSchema.default({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
  headers: z.record(z.string(), z.string()).optional(),
  /**
   * pi 的 OpenAICompletionsCompat 等兼容开关，透传给 models.json。
   * 应用默认会补上 supportsDeveloperRole: false（部分网关只认 system role）。
   */
  compat: z.record(z.string(), z.unknown()).optional(),
});

export const providerSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().min(1).optional(),
  baseUrl: z.string().min(1),
  api: z.enum(API_TYPES).default("openai-completions"),
  apiKey: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  models: z.array(providerModelSchema).min(1),
});

export const appConfigSchema = z.object({
  providers: z.array(providerSchema).default([]),
  /** "provider/model"，null 表示使用第一个可用模型 */
  defaultModel: z.string().min(1).nullable().default(null),
  thinkingLevel: z.enum(THINKING_LEVELS).default("off"),
});

/** 更新时 apiKey 可省略：省略则沿用该 provider 已保存的 key */
export const providerPatchSchema = providerSchema.partial({ apiKey: true });

export const appConfigPatchSchema = z.object({
  providers: z.array(providerPatchSchema).optional(),
  defaultModel: z.string().min(1).nullable().optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

export const configTestSchema = z.object({
  baseUrl: z.string().min(1),
  /** 留空时回落到 providerId 已保存的 key */
  apiKey: z.string().optional(),
  providerId: z.string().min(1).optional(),
  api: z.enum(API_TYPES).default("openai-completions"),
  model: z.string().min(1),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppConfigPatch = z.infer<typeof appConfigPatchSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
export type ProviderModel = z.infer<typeof providerModelSchema>;
export type ApiType = (typeof API_TYPES)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
