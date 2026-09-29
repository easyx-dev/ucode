/** 会话消息投影：磁盘历史 + 活跃会话正在生成的在途消息 */
import type { AgentSession, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { MessageDTO } from "@ucode/contracts";

import { entriesToDTO, messageToDTO, type TranscriptState } from "./serialize";

export type SessionProjection = {
  messages: MessageDTO[];
  /** 在途消息 id；前端据此标记该条为生成中 */
  liveMessageId?: string;
};

/** 在途消息的稳定 id，同一会话内可被前端反复识别为同一条 */
export const liveMessageIdOf = (sessionId: string): string => `live-${sessionId}`;

/**
 * pi 只在 message_end 落盘，正在生成的 assistant 消息只活在 agent state。
 * 刷新后必须把它取出来，否则在途正文与刚声明的工具调用都会凭空消失；
 * 执行中的工具卡片由已落盘的 assistant 消息（含 toolCall 块）承载。
 *
 * `states` 是每条条目生效时的会话级设置（`transcriptStates` 从全量路径算出）。
 */
export const projectMessages = (
  sessionId: string,
  session: AgentSession | undefined,
  entries: SessionEntry[],
  states: ReadonlyMap<string, TranscriptState>,
): SessionProjection => {
  const messages = entriesToDTO(entries, states);
  const streaming = session?.state.streamingMessage;
  if (!session?.isStreaming || !streaming) return { messages };

  const liveMessageId = liveMessageIdOf(sessionId);
  // 在途消息用会话当前档位；provider 由消息自带
  const dto = messageToDTO(streaming, liveMessageId, undefined, {
    thinkingLevel: session.thinkingLevel,
  });
  if (!dto) return { messages };
  return { messages: [...messages, dto], liveMessageId };
};
