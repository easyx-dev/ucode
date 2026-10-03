/** pi 的会话条目与消息 → 对外 DTO */
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SESSION_MODE,
  type MessageBlock,
  type MessageDTO,
  type SessionSummary,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@ucode/contracts";
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

/** 会话条目里的档位名未必落在契约枚举内，非法值按「未知」处理，不阻断投影 */
const toThinkingLevel = (value: unknown): ThinkingLevel | undefined =>
  typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : undefined;

/**
 * 逐条投影时向后传递的会话级设置：assistant 消息自身不携带 pi 档位，
 * 由它之前最近的 `thinking_level_change` / `model_change` 条目补上。
 */
export type TranscriptState = {
  provider?: string;
  thinkingLevel?: ThinkingLevel;
};

/**
 * 沿完整会话路径推进会话级设置，得到每条条目生效时的 provider / 档位。
 *
 * 入参必须是全量路径（含被压缩裁剪掉的条目）：压缩只裁剪展示用的
 * `buildContextEntries()`，而状态是累积的，只看裁剪后的列表会让压缩点之后的历史
 * 消息丢掉 provider / 档位。状态只在真正变化时才新建对象，其余条目共享同一引用。
 */
export const transcriptStates = (entries: SessionEntry[]): Map<string, TranscriptState> => {
  const states = new Map<string, TranscriptState>();
  let current: TranscriptState = {};

  for (const entry of entries) {
    if (entry.type === "thinking_level_change") {
      const level = toThinkingLevel(entry.thinkingLevel);
      if (level) current = { ...current, thinkingLevel: level };
    } else if (entry.type === "model_change") {
      current = { ...current, provider: entry.provider };
    }
    states.set(entry.id, current);
  }

  return states;
};

/** 把 pi 的 AgentMessage 转成前端 DTO */
export const messageToDTO = (
  message: unknown,
  id: string,
  fallbackCreatedAt?: string,
  state: TranscriptState = {},
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
        provider: typeof message.provider === "string" ? message.provider : state.provider,
        ...(state.thinkingLevel ? { thinkingLevel: state.thinkingLevel } : {}),
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
export const entryToDTO = (entry: SessionEntry, state: TranscriptState = {}): MessageDTO | null => {
  const fallbackCreatedAt = isoOf(Date.parse(entry.timestamp));

  switch (entry.type) {
    case "message":
      return messageToDTO(entry.message, entry.id, fallbackCreatedAt, state);
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

/**
 * 把展示用的条目转成前端 DTO；`states` 提供每条条目生效时的会话级设置
 * （由 `transcriptStates` 从全量路径算出，见其说明）。
 * system 提示、usage、label 等内部条目会被过滤掉。
 */
export const entriesToDTO = (
  entries: SessionEntry[],
  states: ReadonlyMap<string, TranscriptState>,
): MessageDTO[] => {
  const messages: MessageDTO[] = [];
  for (const entry of entries) {
    const dto = entryToDTO(entry, states.get(entry.id) ?? {});
    if (dto) messages.push(dto);
  }
  return messages;
};

export const sessionInfoToDTO = (
  info: SessionInfo,
  override: SessionOverride,
  defaultModel: string | null,
  defaultThinkingLevel: ThinkingLevel,
  running: boolean,
  childCount: number,
): SessionSummary => ({
  id: info.id,
  name: info.name ?? override.name ?? null,
  cwd: info.cwd,
  createdAt: info.created.toISOString(),
  updatedAt: info.modified.toISOString(),
  preview: info.firstMessage ?? "",
  model: override.model ?? defaultModel,
  thinkingLevel: override.thinkingLevel ?? defaultThinkingLevel,
  mode: override.mode ?? DEFAULT_SESSION_MODE,
  parentSessionId: override.parentSessionId ?? null,
  agent: override.agent ?? null,
  forkedFromId: override.forkedFromId ?? null,
  childCount,
  running,
  deletedAt: override.deletedAt ?? null,
});

/** 还没落盘（没有 assistant 回复）的草稿会话；草稿也可能正在生成首轮回复 */
export const draftSessionSummary = (
  sessionId: string,
  override: SessionOverride,
  defaultModel: string | null,
  defaultThinkingLevel: ThinkingLevel,
  /** 覆盖值与会话工作区都缺失时的兜底（全局工作目录） */
  fallbackCwd: string,
  running: boolean,
  /** 未归档的直接子会话数；草稿阶段恒为 0，由调用方按记录给出 */
  childCount: number,
  /** 来自数据库行的真实时间；缺省（新建会话刚返回）时用当前时间 */
  timestamps?: { createdAt: string; updatedAt: string },
): SessionSummary => {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    name: override.name ?? null,
    // 未绑定目录的会话没有显式 cwd，工作区就是它的工作目录
    cwd: override.cwd ?? fallbackCwd,
    createdAt: timestamps?.createdAt ?? now,
    updatedAt: timestamps?.updatedAt ?? now,
    preview: "",
    model: override.model ?? defaultModel,
    thinkingLevel: override.thinkingLevel ?? defaultThinkingLevel,
    mode: override.mode ?? DEFAULT_SESSION_MODE,
    parentSessionId: override.parentSessionId ?? null,
    agent: override.agent ?? null,
    forkedFromId: override.forkedFromId ?? null,
    childCount,
    running,
    deletedAt: override.deletedAt ?? null,
  };
};
