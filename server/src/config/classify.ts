/** 配置变更的影响面分级：决定保存配置后要不要重建 ModelRuntime 与会话装配。 */
import { isDeepStrictEqual } from "node:util";

import type { AppConfig } from "@ucode/contracts";

/** `lazy`：只对下一次读配置生效；`runtime`：要重建 ModelRuntime 与会话装配 */
export type ConfigChangeKind = "lazy" | "runtime";

/**
 * 运行期读取、改它不必重建运行时的字段；其余字段一律按 `runtime` 处理。
 * 白名单方向是刻意的：装配期新增字段时漏登记只会多重建一次，不会静默漏掉重建。
 */
const LAZY_FIELDS = ["websearch", "browser"] as const;

/** 去掉 lazy 字段后的配置，用于比较「真正与运行时 / 会话装配相关的那部分」 */
const runtimeRelevant = (config: AppConfig): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...config };
  for (const field of LAZY_FIELDS) delete rest[field];
  return rest;
};

/**
 * 按「变更后的配置」与「当前配置」对比 —— 客户端提交的是全量 patch，从 patch 里出现了哪些
 * 字段看不出真实改动。
 *
 * 联网搜索与浏览器工具都是运行期读取（前者读闭包、后者在 browser_open 里读配置），改它们不必重建运行时；
 * provider 目录、默认模型与记忆开关都在会话装配时读入，必须重建。
 */
export const classifyConfigChange = (next: AppConfig, current: AppConfig): ConfigChangeKind =>
  isDeepStrictEqual(runtimeRelevant(next), runtimeRelevant(current)) ? "lazy" : "runtime";
