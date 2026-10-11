/**
 * 会话转录的通用读取：从 pi 的会话消息里取纯文本、截取最近交流。
 *
 * 目标校验与项目记忆回顾都按同一口径读交流，抽在这里避免两处各写一份。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { textOfContent } from "../utils/text";

export type SessionMessage = AgentSession["messages"][number];

/** 一条消息的纯文本：用户消息可能是字符串，助手消息是内容块数组 */
export const textOf = (message: { content?: unknown }): string =>
  textOfContent(message.content, "\n");

export type ExchangeTurn = {
  role: "user" | "assistant";
  text: string;
};

/** 从末尾回看若干轮用户消息及其助手回复，拼成交流；总长超限时从最早的丢起 */
export const sliceExchange = (
  messages: readonly SessionMessage[],
  maxUserTurns: number,
  maxChars: number,
): ExchangeTurn[] => {
  const turns: ExchangeTurn[] = [];
  let userTurns = 0;

  for (let index = messages.length - 1; index >= 0 && userTurns < maxUserTurns; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textOf(message).trim();
    if (!text) continue;
    turns.push({ role: message.role, text });
    if (message.role === "user") userTurns += 1;
  }
  turns.reverse();

  let total = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (turns.length > 1 && total > maxChars) {
    total -= turns[0]?.text.length ?? 0;
    turns.shift();
  }
  // 只剩最后一轮仍超限时按预算截断，避免单条超大回复绕过上限
  const first = turns[0];
  if (first && total > maxChars) {
    const keep = Math.max(0, maxChars - (total - first.text.length));
    turns[0] = { ...first, text: first.text.slice(0, keep) };
  }
  return turns;
};
