/** 配置变更的影响面分级：决定保存配置后要不要重建 ModelRuntime 与会话装配。 */
import { isDeepStrictEqual } from "node:util";

import type { AppConfig } from "@ucode/contracts";

/** `lazy`：只对下一次读配置生效；`runtime`：要重建 ModelRuntime 与会话装配 */
export type ConfigChangeKind = "lazy" | "runtime";

/**
 * 按「变更后的配置」与「当前配置」对比 —— 客户端提交的是全量 patch，从 patch 里出现了哪些
 * 字段看不出真实改动。
 *
 * 只有联网搜索是运行期读取（自研 websearch 工具在调用时读闭包），改它不必重建运行时；
 * provider 目录、默认模型与记忆开关都在会话装配时读入，必须重建。
 * 装配期新增字段时必须加进下面的比较，漏掉会静默归为 `lazy`。
 */
export const classifyConfigChange = (next: AppConfig, current: AppConfig): ConfigChangeKind =>
  isDeepStrictEqual(next.providers, current.providers) &&
  next.defaultModel === current.defaultModel &&
  isDeepStrictEqual(next.memory, current.memory)
    ? "lazy"
    : "runtime";
