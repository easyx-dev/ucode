/** 应用配置（provider / 模型 / 默认值）的请求侧 zod 模型，同时是 config.json 的持久化结构 */
import { z } from "zod";

import { API_TYPES, THINKING_LEVELS, type ThinkingLevel } from "../constants";

/** 分档计价：命中 inputTokensAbove 最高阈值的那一档，应用于整个请求 */
export const modelCostTierSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  inputTokensAbove: z.number().nonnegative(),
});

export const modelCostSchema = z.object({
  input: z.number().nonnegative().default(0),
  output: z.number().nonnegative().default(0),
  cacheRead: z.number().nonnegative().default(0),
  cacheWrite: z.number().nonnegative().default(0),
  tiers: z.array(modelCostTierSchema).optional(),
});

/** 图片缩放档：图片进入对话历史前按此预处理 */
export const modelImageResizeSchema = z.object({
  maxWidth: z.number().int().positive().optional(),
  maxHeight: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
  jpegQuality: z.number().int().min(1).max(100).optional(),
});

export const modelInputLimitsSchema = z.object({
  /** 单次请求序列化后的体积上限（字节） */
  maxRequestBytes: z.number().int().positive().optional(),
  images: z
    .object({
      resize: modelImageResizeSchema.optional(),
      maxPerMessage: z.number().int().positive().optional(),
      maxPerRequest: z.number().int().positive().optional(),
    })
    .optional(),
});

/** 提示缓存时长；留空表示该档未知 */
export const modelPromptCacheSchema = z.object({
  short: z.number().nonnegative().optional(),
  long: z.number().nonnegative().optional(),
});

/**
 * pi 的 ModelThinkingLevel → 厂商取值：null 表示该档不支持，缺键表示用厂商默认。
 * `satisfies` 让键集与 THINKING_LEVELS 始终同步，改动任一侧都会编译失败。
 */
export const thinkingLevelMapSchema = z
  .object({
    off: z.string().nullable(),
    minimal: z.string().nullable(),
    low: z.string().nullable(),
    medium: z.string().nullable(),
    high: z.string().nullable(),
    xhigh: z.string().nullable(),
    max: z.string().nullable(),
  } satisfies Record<ThinkingLevel, z.ZodNullable<z.ZodString>>)
  .partial();

export const providerModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  api: z.enum(API_TYPES).optional(),
  baseUrl: z.string().min(1).optional(),
  reasoning: z.boolean().default(false),
  /** 留空时按厂商默认映射；显式给出的档位覆盖厂商默认 */
  thinkingLevelMap: thinkingLevelMapSchema.optional(),
  input: z
    .array(z.enum(["text", "image"]))
    .min(1)
    .default(["text"]),
  inputLimits: modelInputLimitsSchema.optional(),
  contextWindow: z.number().int().positive().default(128000),
  maxTokens: z.number().int().positive().default(8192),
  cost: modelCostSchema.default({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
  promptCache: modelPromptCacheSchema.optional(),
  /** 该模型的默认采样参数，单次请求可覆盖 */
  samplingParams: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /**
   * pi 的 OpenAICompletionsCompat 等兼容开关，原样透传给 pi 的 provider 配置。
   * 具体字段随 api 收窄，详见 pi 的 *Compat 类型。
   * 应用默认会补上 supportsDeveloperRole: false（部分网关只认 system role）。
   */
  compat: z.record(z.string(), z.unknown()).optional(),
});

export const providerSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().min(1).optional(),
  /** 留空表示沿用 pi 内置目录的同名 provider；自定义 provider 必须给出 */
  baseUrl: z.string().min(1).optional(),
  api: z.enum(API_TYPES).default("openai-completions"),
  apiKey: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  /** 是否自动补 `Authorization: Bearer` 请求头 */
  authHeader: z.boolean().optional(),
  /** provider 级兼容开关，作用于其下所有模型；模型级同名项优先 */
  compat: z.record(z.string(), z.unknown()).optional(),
  /** 留空表示模型清单沿用 pi 内置目录；一旦给出即为整体替换（不是按 id 合并） */
  models: z.array(providerModelSchema).min(1).optional(),
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
export type AppConfigPatchInput = z.infer<typeof appConfigPatchSchema>;
/** 客户端发送的配置更新载荷（模型字段的默认值可省） */
export type AppConfigPatchRequest = z.input<typeof appConfigPatchSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
export type ProviderModel = z.infer<typeof providerModelSchema>;
export type ConfigTestInput = z.infer<typeof configTestSchema>;
/** 客户端发送的连通性测试载荷（api 默认 openai-completions，可省） */
export type ConfigTestRequest = z.input<typeof configTestSchema>;
