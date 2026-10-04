/** 消息接口的响应模型；SSE 事件的 data 也复用这里的区块结构 */
import type { SessionScoped } from "../common";
import type { MessageRole, ThinkingLevel } from "../constants";

export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; id: string; name: string; args: unknown }
  | { type: "image"; id: string; mimeType: string; url: string }
  | { type: "file"; id: string; mimeType: string; name: string; size: number; url: string };

export type MessageDTO = {
  id: string;
  role: MessageRole;
  blocks: MessageBlock[];
  /** assistant 专用：产生该回复的模型 id */
  model?: string;
  /** assistant 专用：模型所属 provider id */
  provider?: string;
  /** assistant 专用：产生该回复时生效的推理等级 */
  thinkingLevel?: ThinkingLevel;
  /** tool 专用：与 toolCall block 的 id 对应，便于前端精确合并 */
  toolCallId?: string;
  /** tool 专用 */
  toolName?: string;
  isError?: boolean;
  /** 消息产生时间（ISO 8601 UTC）；时间不可用时缺省 */
  createdAt?: string;
};

export type MessageListResponse = SessionScoped & {
  messages: MessageDTO[];
  /** 是否已有落盘会话文件 */
  persisted: boolean;
  /** 会话工作目录 */
  cwd: string;
  /** 是否有活跃生成（进程内的 run 或流式会话） */
  running: boolean;
  /**
   * 快照序号：本响应已包含到该序号为止的全部事件效果。
   * 客户端订阅后丢弃 seq <= 它的实时帧，可无缝接续。
   */
  seq: number;
  /** 投影出的在途消息 id；前端据此把该条标记为生成中 */
  liveMessageId?: string;
};

/** prompt 的受理回执：生成本身由服务端后台推进，与本请求无关 */
export type PromptAdmittedResponse = SessionScoped & {
  admitted: boolean;
};

export type MessageInterruptResponse = SessionScoped & {
  /** 是否真的中断了一个正在跑的 run */
  aborted: boolean;
};
