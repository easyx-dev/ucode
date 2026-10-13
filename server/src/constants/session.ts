/**
 * 会话与运行时参数：事件订阅、模型请求重试、思考档位缺省值、上下文预算与旧工具输出清理。
 *
 * 压缩相关的一组是同一套口径：触发点由「有效预算」算出，池注入 pi 的阈值与界面显示的预算都取自它。
 */
import type { ThinkingLevel } from "@ucode/contracts";

/** 单个 /events 订阅者的待发队列上限；溢出即断开，由客户端重连补齐 */
export const SUBSCRIBER_QUEUE_MAX = 256;

/** /events 的心跳间隔（毫秒），防止中间代理掐掉空闲连接 */
export const EVENTS_HEARTBEAT_MS = 15_000;

/** 回合级模型请求重试上限（pi 的 `retry.maxRetries` 默认 3，这里提到 5） */
export const RETRY_MAX_ATTEMPTS = 5;

/**
 * 模式的推荐思考档位缺省值：primary 角色没声明推荐值时用它（自定义模式不写 `thinking` 的情形）。
 * 取 `medium` 与 pi 自己的缺省一致（`CreateAgentSessionOptions.thinkingLevel` 缺省即 medium）。
 */
export const DEFAULT_RECOMMENDED_THINKING_LEVEL: ThinkingLevel = "medium";

/**
 * 上下文预算：压缩的触发点与保留量。
 *
 * 触发点按「有效预算」而不是模型声明的窗口算——pi 的默认判据（窗口 − 16k）在 1M 窗口下几乎永不触发。
 * 上限取「能力优先」：单步延迟随上下文线性上升，但长任务确实要用到大容量，所以不把上限压到退化点附近；
 * 需要更早压缩的模型在配置里写 `contextBudget` 覆盖。
 */
export const CONTEXT_BUDGET_MAX_TOKENS = 850_000;

/** 触发点相对窗口的留白比例：给输出与下一批工具结果留空间 */
export const CONTEXT_BUDGET_RESERVE_RATIO = 0.1;

/** 触发点留白的下限；小窗口模型按这个走，不要按比例缩到没有余量 */
export const CONTEXT_BUDGET_RESERVE_MIN_TOKENS = 16_384;

/** 压缩后保留的最近 token 比例 / 上下限 */
export const CONTEXT_KEEP_RATIO = 0.15;
export const CONTEXT_KEEP_MIN_TOKENS = 4_000;
export const CONTEXT_KEEP_MAX_TOKENS = 40_000;

/** 旧工具输出清理：最近这么多轮（用户消息为界）的工具结果受保护，不动 */
export const PRUNE_PROTECTED_USER_TURNS = 2;

/** 旧工具输出清理：最近这么多 token 的工具结果受保护，不动 */
export const PRUNE_PROTECT_TOKENS = 40_000;

/** 一次清理至少要腾出这么多 token 才动手；碎片式清理会把前缀缓存打断得毫无收益 */
export const PRUNE_MIN_CLEARED_TOKENS = 20_000;

/** 清理后的占位文本：保留消息本身，只换掉正文，避免 tool-call 与结果配不上 */
export const PRUNE_PLACEHOLDER = "[旧工具输出已清理。需要原文就重跑那条命令或重新读取。]";

/** 清旧工具输出时跳过的工具：这些结果本身就是结论，清掉等于让模型重做一遍 */
export const PRUNE_PROTECTED_TOOLS = ["subagent", "edit", "write", "present_plan"];

/**
 * 单次清理的条数上限：每条都要落一次盘，且都在一轮结束的回调里同步做。
 * 旧会话第一次清理可能命中几十上百条，这里切一刀，剩下的留给下一轮。
 */
export const PRUNE_MAX_EDITS_PER_PASS = 50;

/**
 * 会话原始记录（`sessions/transcript`）单次返回的上限。
 *
 * 一条会话增长得比想象得快（长对话的 JSONL 常见几 MB），内联回去的整段文本要经过 HTTP、
 * 客户端解析与剪贴板三道，再大就没有意义了；超限时如实回 `payload_too_large`，让用户自己去看文件。
 */
export const TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;

/** 上面那个上限的展示形式（MB）：错误文案与 `payload_too_large` 的插值都用它 */
export const TRANSCRIPT_MAX_MB = TRANSCRIPT_MAX_BYTES / (1024 * 1024);
