/** 消息接口的响应模型；SSE 事件的 data 也复用这里的区块结构 */
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
  /** tool 专用：与 toolCall block 的 id 对应，便于前端精确合并 */
  toolCallId?: string;
  /** tool 专用 */
  toolName?: string;
  isError?: boolean;
  /** 毫秒时间戳 */
  timestamp?: number;
};

export type MessageListResponse = {
  sessionId: string;
  messages: MessageDTO[];
  /** 是否已有落盘会话文件 */
  persisted: boolean;
  /** 会话工作目录 */
  cwd: string;
};

export type MessageInterruptResponse = {
  sessionId: string;
  /** 是否真的中断了一个正在跑的 run */
  aborted: boolean;
};
