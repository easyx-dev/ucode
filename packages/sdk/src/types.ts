/** 会话流在界面上消费的类型：消息条目与子智能体进度（供各端复用） */
import type { AttachmentView, ContextRef, MessageDTO } from "@ucode/contracts";

/** 单条 assistant 消息的思考耗时；由客户端按事件到达时间测得，不落盘、快照重建后不再有 */
export type ChatItemTiming = {
  /** 思考阶段耗时（毫秒） */
  thinkingMs?: number;
};

/** 界面上的一条消息：live 表示还在流式生成中，timing 为本次运行测得的耗时 */
export type ChatItem = MessageDTO & { live?: boolean; timing?: ChatItemTiming };

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

/** 一条 prompt 的结构化载荷：正文 + `@` 上下文引用 + 附件 */
export type PromptPayload = {
  text: string;
  contexts: ContextRef[];
  attachments: AttachmentView[];
};
