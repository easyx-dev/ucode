/** 会话流在界面上消费的类型：消息条目与子智能体进度（供各端复用） */
import type { AttachmentRef, ContextRef, MessageDTO } from "@ucode/contracts";

/** 单条 assistant 消息的思考耗时；由客户端按事件到达时间测得，不落盘、快照重建后不再有 */
export type ChatItemTiming = {
  /** 思考阶段耗时（毫秒） */
  thinkingMs?: number;
};

/**
 * 界面上的一条消息。
 *
 * `uid` 是跨「乐观条目 → 权威条目」不变的界面标识：`message_end` 会用服务端消息整体替掉乐观条目，
 * `id` 随之从 `live-assistant-1` 换成服务端 id，而列表行、展开状态与滚动位置都挂在以它为源的 key 上，
 * 直接拿 `id` 做 key 会在每次落定时把整行卸载重建（看得见的闪一下）。
 */
export type ChatItem = MessageDTO & {
  /** 仍在流式生成中 */
  live?: boolean;
  /** 本次运行测得的耗时 */
  timing?: ChatItemTiming;
  /** 不变的界面标识；缺失时以 `id` 当值（历史快照里的条目就是如此） */
  uid?: string;
};

/**
 * 一次子智能体委派在界面上的进度：`toolCallId` 为键，嵌套内容是子会话自己的消息。
 * 进度不落盘，刷新后不重建，只作实时展示。
 */
export type SubagentStream = {
  /** 子会话 id；据此可从卡片直接打开该子会话 */
  sessionId: string;
  /** 任务简称，服务端已按长度截断；用于嵌套卡标题 */
  description: string;
  /** 子会话的消息列表（按事件流实时归并） */
  items: ChatItem[];
  /** 是否已结束（收到 `subagent_end` 或父会话落定） */
  done: boolean;
  isError: boolean;
};

/** 按父会话里的 `toolCallId` 索引的进行中子智能体 */
export type SubagentStreams = Record<string, SubagentStream>;

/**
 * 一条 prompt 的结构化载荷：正文 + `@` 上下文引用 + 附件引用。
 * 附件只带 id：引用按内容寻址，正文里的位置由 `图片 N` / `附件 N.<ext>` 标记表达。
 */
export type PromptPayload = {
  text: string;
  contexts: ContextRef[];
  attachments: AttachmentRef[];
};

/**
 * 编辑重发的载荷：正文 + 原消息里的 `@` 引用与附件。
 * 附件只带 id —— 引用按内容寻址，重建时不需要名称 / 大小这些视图信息。
 */
export type EditMessagePayload = {
  text: string;
  contexts?: ContextRef[];
  /** 只带 id 的附件引用 */
  attachments?: AttachmentRef[];
};
