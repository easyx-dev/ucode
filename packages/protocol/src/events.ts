import { z } from "zod";
import { SessionEntrySchema } from "./session.ts";

/**
 * 事件面（spec §4.5）：单向、有序、可重放。
 *
 * 三条不变量在类型上就能看出来：
 * 1. `entry_appended` 是**权威**（携带完整记录 + 行序号游标），`message_delta` 是**非权威**的流式增量；
 * 2. `turn_end` 与 `agent_settled` 是两个不同的信号——后者才是"不再有任何自动工作待办"；
 * 3. 中途挂载与断线续传靠 `seq`（= 记录在文件里的行序号，header 为第 0 行），游标失效必须显式通知。
 */

/** 用量（沿用 pi 的 Usage 形状，附加字段原样透传）。 */
export const UsageSchema = z.looseObject({
  kind: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  input: z.number().optional(),
  output: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  totalTokens: z.number().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const SessionStatusSchema = z.enum([
  "idle",
  "running",
  "compacting",
  "retrying",
  /** 等待人类交互：无人值守下据此决定是否通知用户（spec §4.11）。 */
  "waiting",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const EntryAppendedEventSchema = z.object({
  type: z.literal("entry_appended"),
  sessionId: z.string(),
  /** 游标：该记录在文件中的行序号（header 为第 0 行）。 */
  seq: z.number().int().nonnegative(),
  entry: SessionEntrySchema,
});

export const MessageDeltaEventSchema = z.object({
  type: z.literal("message_delta"),
  sessionId: z.string(),
  /** 流式增量仅用于展示，可能合并、乱序、丢失；权威信号是 entry_appended。 */
  kind: z.enum(["text", "thinking", "tool_input"]),
  delta: z.string(),
  /** 进行中的消息在会话里的位置（同一轮内单调递增）。 */
  index: z.number().int().nonnegative(),
});

export const TurnStartEventSchema = z.object({
  type: z.literal("turn_start"),
  sessionId: z.string(),
});

export const TurnEndEventSchema = z.object({
  type: z.literal("turn_end"),
  sessionId: z.string(),
  /** 本轮 assistant 记录与工具结果记录的 id（若已落盘）。 */
  entryId: z.string().nullable(),
  toolResultIds: z.array(z.string()),
});

/** 真正的完成信号：不再有任何自动工作待办（区别于 turn_end）。 */
export const AgentSettledEventSchema = z.object({
  type: z.literal("agent_settled"),
  sessionId: z.string(),
});

export const UsageEventSchema = z.object({
  type: z.literal("usage"),
  sessionId: z.string(),
  usage: UsageSchema,
});

export const StatusEventSchema = z.object({
  type: z.literal("status"),
  sessionId: z.string(),
  status: SessionStatusSchema,
  pendingInteractions: z.number().int().nonnegative(),
});

/**
 * 游标失效的显式信号（spec §4.5）。
 * 触发源：格式迁移导致原地重写（V-5 已推翻"迁移不写回"）、崩溃留下的不完整尾部被截断。
 * 收到后控制层必须重新全量同步——不能只靠 inode 变化发现整体替换。
 */
export const ResyncRequiredEventSchema = z.object({
  type: z.literal("resync_required"),
  sessionId: z.string(),
  reason: z.enum(["migration", "truncated_tail", "cursor_invalid"]),
  /** 重新同步后的当前游标（客户端从这里继续跟随）。 */
  cursor: z.number().int().nonnegative(),
});

export const EventSchema = z.discriminatedUnion("type", [
  EntryAppendedEventSchema,
  MessageDeltaEventSchema,
  TurnStartEventSchema,
  TurnEndEventSchema,
  AgentSettledEventSchema,
  UsageEventSchema,
  StatusEventSchema,
  ResyncRequiredEventSchema,
]);
export type SessionEvent = z.infer<typeof EventSchema>;
export type SessionEventType = SessionEvent["type"];
