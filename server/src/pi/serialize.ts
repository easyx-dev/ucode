/** pi 的会话条目与消息 → 对外 DTO */
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";

import type { ThinkingLevel } from "../config/schema";
import type { SessionOverride } from "../config/session-state";

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

export type SessionSummaryDTO = {
  id: string;
  name: string | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
  model: string | null;
  thinkingLevel: ThinkingLevel;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const blocksOf = (content: unknown): MessageBlock[] => {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks: MessageBlock[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    switch (part.type) {
      case "text":
        if (typeof part.text === "string") blocks.push({ type: "text", text: part.text });
        break;
      case "thinking":
        if (typeof part.thinking === "string")
          blocks.push({ type: "thinking", text: part.thinking });
        break;
      case "toolCall":
        if (typeof part.name === "string") {
          blocks.push({
            type: "toolCall",
            id: typeof part.id === "string" ? part.id : "",
            name: part.name,
            args: part.arguments,
          });
        }
        break;
      case "image":
        blocks.push({ type: "text", text: "[图片]" });
        break;
      default:
        break;
    }
  }
  return blocks;
};

/** 把 pi 的 AgentMessage 转成前端 DTO */
export const messageToDTO = (
  message: unknown,
  id: string,
  fallbackTimestamp?: number,
): MessageDTO | null => {
  if (!isRecord(message)) return null;
  const role = message.role;
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : fallbackTimestamp;

  switch (role) {
    case "user":
      return { id, role: "user", blocks: blocksOf(message.content), timestamp };
    case "assistant":
      return {
        id,
        role: "assistant",
        blocks: blocksOf(message.content),
        model: typeof message.model === "string" ? message.model : undefined,
        timestamp,
      };
    case "toolResult":
      return {
        id,
        role: "tool",
        blocks: blocksOf(message.content),
        toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
        toolName: typeof message.toolName === "string" ? message.toolName : undefined,
        isError: message.isError === true,
        timestamp,
      };
    case "custom":
      return { id, role: "custom", blocks: blocksOf(message.content), timestamp };
    default:
      // system / bashExecution / 其他内部消息不展示
      return null;
  }
};

/** 把会话条目转成前端 DTO；system 提示、usage、label 等内部条目会被过滤掉 */
export const entryToDTO = (entry: SessionEntry): MessageDTO | null => {
  const fallback = Date.parse(entry.timestamp);

  switch (entry.type) {
    case "message":
      return messageToDTO(entry.message, entry.id, fallback);
    case "custom_message":
      return {
        id: entry.id,
        role: "custom",
        blocks: blocksOf(entry.content),
        timestamp: fallback,
      };
    case "compaction":
      return {
        id: entry.id,
        role: "summary",
        blocks: entry.summary ? [{ type: "text", text: entry.summary }] : [],
        timestamp: fallback,
      };
    default:
      return null;
  }
};

export const entriesToDTO = (entries: SessionEntry[]): MessageDTO[] => {
  const result: MessageDTO[] = [];
  for (const entry of entries) {
    const dto = entryToDTO(entry);
    if (dto) result.push(dto);
  }
  return result;
};

export const sessionInfoToDTO = (
  info: SessionInfo,
  override: SessionOverride,
  defaultModel: string | null,
  defaultThinkingLevel: ThinkingLevel,
): SessionSummaryDTO => ({
  id: info.id,
  name: info.name ?? override.name ?? null,
  cwd: info.cwd,
  createdAt: info.created.toISOString(),
  updatedAt: info.modified.toISOString(),
  messageCount: info.messageCount,
  preview: info.firstMessage ?? "",
  model: override.model ?? defaultModel,
  thinkingLevel: override.thinkingLevel ?? defaultThinkingLevel,
});

/** 还没落盘（没有 assistant 回复）的草稿会话 */
export const draftSessionSummary = (
  sessionId: string,
  override: SessionOverride,
  defaultModel: string | null,
  defaultThinkingLevel: ThinkingLevel,
  fallbackCwd: string,
): SessionSummaryDTO => {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    name: override.name ?? null,
    cwd: override.cwd ?? fallbackCwd,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    preview: "",
    model: override.model ?? defaultModel,
    thinkingLevel: override.thinkingLevel ?? defaultThinkingLevel,
  };
};
