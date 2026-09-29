/** pi 的会话条目与消息 → 对外 DTO */
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import type { MessageBlock, MessageDTO, SessionSummary, ThinkingLevel } from "@ucode/contracts";

import type { SessionOverride } from "../db/session-repository";
import { isRecord } from "../utils/object";

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

/**
 * 条目/消息时间戳 → ISO 8601 字符串；缺失、非数字、越界或非法时返回 undefined。
 * `Number.isFinite` 拦不住 `1e308` 这类越界值，`toISOString()` 会抛 RangeError，
 * 所以必须先构造 Date 再用 `getTime()` 判合法。
 */
const isoOf = (time: unknown): string | undefined => {
  if (typeof time !== "number" || !Number.isFinite(time)) return undefined;
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

/** 把 pi 的 AgentMessage 转成前端 DTO */
export const messageToDTO = (
  message: unknown,
  id: string,
  fallbackCreatedAt?: string,
): MessageDTO | null => {
  if (!isRecord(message)) return null;
  const role = message.role;
  const createdAt = isoOf(message.timestamp) ?? fallbackCreatedAt;

  switch (role) {
    case "user":
      return { id, role: "user", blocks: blocksOf(message.content), createdAt };
    case "assistant":
      return {
        id,
        role: "assistant",
        blocks: blocksOf(message.content),
        model: typeof message.model === "string" ? message.model : undefined,
        createdAt,
      };
    case "toolResult":
      return {
        id,
        role: "tool",
        blocks: blocksOf(message.content),
        toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
        toolName: typeof message.toolName === "string" ? message.toolName : undefined,
        isError: message.isError === true,
        createdAt,
      };
    case "custom":
      return { id, role: "custom", blocks: blocksOf(message.content), createdAt };
    default:
      // system / bashExecution / 其他内部消息不展示
      return null;
  }
};

/** 把会话条目转成前端 DTO；system 提示、usage、label 等内部条目会被过滤掉 */
export const entryToDTO = (entry: SessionEntry): MessageDTO | null => {
  const fallbackCreatedAt = isoOf(Date.parse(entry.timestamp));

  switch (entry.type) {
    case "message":
      return messageToDTO(entry.message, entry.id, fallbackCreatedAt);
    case "custom_message":
      return {
        id: entry.id,
        role: "custom",
        blocks: blocksOf(entry.content),
        createdAt: fallbackCreatedAt,
      };
    case "compaction":
      return {
        id: entry.id,
        role: "summary",
        blocks: entry.summary ? [{ type: "text", text: entry.summary }] : [],
        createdAt: fallbackCreatedAt,
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
  running: boolean,
): SessionSummary => ({
  id: info.id,
  name: info.name ?? override.name ?? null,
  cwd: info.cwd,
  createdAt: info.created.toISOString(),
  updatedAt: info.modified.toISOString(),
  messageCount: info.messageCount,
  preview: info.firstMessage ?? "",
  model: override.model ?? defaultModel,
  thinkingLevel: override.thinkingLevel ?? defaultThinkingLevel,
  running,
});

/** 还没落盘（没有 assistant 回复）的草稿会话；草稿也可能正在生成首轮回复 */
export const draftSessionSummary = (
  sessionId: string,
  override: SessionOverride,
  defaultModel: string | null,
  defaultThinkingLevel: ThinkingLevel,
  fallbackCwd: string,
  running: boolean,
  /** 来自数据库行的真实时间；缺省（新建会话刚返回）时用当前时间 */
  timestamps?: { createdAt: string; updatedAt: string },
): SessionSummary => {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    name: override.name ?? null,
    cwd: override.cwd ?? fallbackCwd,
    createdAt: timestamps?.createdAt ?? now,
    updatedAt: timestamps?.updatedAt ?? now,
    messageCount: 0,
    preview: "",
    model: override.model ?? defaultModel,
    thinkingLevel: override.thinkingLevel ?? defaultThinkingLevel,
    running,
  };
};
