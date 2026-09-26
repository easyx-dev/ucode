import { z } from "zod";

/**
 * 会话记录（协议 D 的条目形状，spec §3.12）。
 *
 * 用宽松对象：记录格式沿用 pi 的约定并由 pi 演进（§3.11），核心层只保证几个公共字段，
 * 其余原样透传。附加字段不得被这里剥掉——否则落盘与广播的内容会与磁盘不一致。
 */
export const SessionEntrySchema = z.looseObject({
  type: z.string(),
  id: z.string(),
  parentId: z.string().nullable(),
  timestamp: z.string(),
});
export type SessionEntry = z.infer<typeof SessionEntrySchema>;

/** 会话的元信息（列表用；来自 store 的扫描与索引对账结果，不是真相）。 */
export const SessionSummarySchema = z.object({
  id: z.string(),
  cwd: z.string(),
  name: z.string().nullable(),
  file: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  entryCount: z.number().int().nonnegative(),
  firstMessage: z.string().nullable(),
  /** 是否正被某个实例持有（owner 语义，spec §3.5）。 */
  owned: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** 会话运行状态（命令面 session.get_state 的返回）。 */
export const SessionStateSchema = z.object({
  sessionId: z.string(),
  name: z.string().nullable(),
  cwd: z.string(),
  model: z.object({ provider: z.string(), modelId: z.string() }).nullable(),
  thinkingLevel: z.string().nullable(),
  autonomy: z.string(),
  /** 忙闲：idle / running / compacting / retrying / waiting（等待人类交互）。 */
  status: z.enum(["idle", "running", "compacting", "retrying", "waiting"]),
  /** 已落盘记录数（= 游标上界）。 */
  cursor: z.number().int().nonnegative(),
  /** 仍在排队等待处理的消息数（用户输入队列）。 */
  pendingMessages: z.number().int().nonnegative(),
  /** 待决交互数：>0 表示这个会话在等人（无人值守下据此决定是否通知）。 */
  pendingInteractions: z.number().int().nonnegative(),
  /** 本会话的 attachment 数（多壳同看一个会话）。 */
  attachments: z.number().int().nonnegative(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/** 分支树的一个节点（命令面 session.get_tree 的返回）。children 递归，故用 lazy + 宽松类型。 */
export type SessionTreeNode = { entry: SessionEntry; children: SessionTreeNode[] };

export const SessionTreeNodeSchema: z.ZodType<SessionTreeNode> = z.lazy(() =>
  z.looseObject({
    entry: SessionEntrySchema,
    children: z.array(SessionTreeNodeSchema),
  }),
);

/**
 * 命令面的"引用参数"（spec §4.4）：发起一轮对话时可引用文件/文件夹/会话/已登记的 SSH 连接/技能/子智能体。
 * 首发只实现 file / folder / session；其余显式拒绝并给出可诊断错误，而不是静默忽略。
 */
export const ReferenceSchema = z.object({
  kind: z.enum(["file", "folder", "session", "ssh", "skill", "agent"]),
  id: z.string(),
  label: z.string().optional(),
});
export type Reference = z.infer<typeof ReferenceSchema>;
