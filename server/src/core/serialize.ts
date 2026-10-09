/** pi 的会话条目与消息 → 对外 DTO */
import { createHash } from "node:crypto";

import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import {
  API_BASE_PATH,
  COMMAND_ASSET_SOURCES,
  COMPACTION_OUTCOMES,
  COMPACTION_REASONS,
  COMPACTION_RECORD_CUSTOM_TYPE,
  COMPACTION_SKIP_REASONS,
  type CompactionOutcome,
  type CompactionReason,
  type CompactionRecord,
  type CompactionSkipReason,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_SESSION_MODE,
  DEFAULT_THINKING_PREFERENCE,
  GOAL_PROMPT_CUSTOM_TYPE,
  GOAL_PROMPT_KINDS,
  GOAL_RECORD_CUSTOM_TYPE,
  GOAL_RECORD_EVENTS,
  type GoalPauseCause,
  type GoalPromptDetails,
  type GoalPromptKind,
  type GoalRecord,
  type GoalRecordEvent,
  type MessageBlock,
  type MessageDTO,
  MODE_RECORD_CUSTOM_TYPE,
  type ModeRecord,
  PERMISSION_DECISION_CUSTOM_TYPE,
  PERMISSION_DECISIONS,
  type PermissionDecision,
  type PermissionRecord,
  PLAN_IGNORED_CUSTOM_TYPE,
  RETRY_RECORD_CUSTOM_TYPE,
  RETRY_RECORD_EVENTS,
  type RetryRecord,
  type SessionStatus,
  type SessionSummary,
  SKILL_RECORD_CUSTOM_TYPE,
  SKILL_RECORD_EVENTS,
  type SkillRecord,
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
        // 图片落库时按归一化后的字节算 sha256，与这里重算的一致，故 url 能直接命中附件路由
        if (typeof part.data === "string" && typeof part.mimeType === "string") {
          const id = createHash("sha256").update(Buffer.from(part.data, "base64")).digest("hex");
          blocks.push({
            type: "image",
            id,
            mimeType: part.mimeType,
            url: `${API_BASE_PATH}/attachments/${id}`,
          });
        } else {
          blocks.push({ type: "text", text: "[图片]" });
        }
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
 * question 工具的结构化答复：工具把 `answers` 放在 `details` 里，而 `details` 只存在于
 * 会话记录，不在给模型看的正文里。界面要按「问题 + 选了什么」重新排版，所以把原始答复
 * 单独下发——去解析那段给模型看的可读文本既脆弱又没必要。
 */
const questionAnswersOf = (message: Record<string, unknown>): { questionAnswers?: string[][] } => {
  if (message.toolName !== "question") return {};
  const details = message.details;
  if (!isRecord(details) || !Array.isArray(details.answers)) return {};
  const answers = details.answers.filter(
    (entry): entry is string[] =>
      Array.isArray(entry) && entry.every((value) => typeof value === "string"),
  );
  return answers.length > 0 ? { questionAnswers: answers } : {};
};

/** 权限审批记录的 `data` 来自会话文件，形状不可信：字段缺失或决定值非法就当没有记录 */
const permissionRecordOf = (data: unknown): PermissionRecord | null => {
  if (!isRecord(data)) return null;
  const { tool, subject, scope, decision, sourceSessionId, sourceDescription } = data;
  if (typeof tool !== "string" || typeof subject !== "string" || typeof scope !== "string") {
    return null;
  }
  if (
    typeof decision !== "string" ||
    !(PERMISSION_DECISIONS as readonly string[]).includes(decision)
  ) {
    return null;
  }
  return {
    tool,
    subject,
    scope,
    decision: decision as PermissionDecision,
    // 来源标注与弹窗一致：子会话发起的请求，回放时也要看得出是它
    ...(typeof sourceSessionId === "string" ? { sourceSessionId } : {}),
    ...(typeof sourceDescription === "string" ? { sourceDescription } : {}),
  };
};

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
        ...questionAnswersOf(message),
        createdAt,
      };
    case "custom":
      return { id, role: "custom", blocks: blocksOf(message.content), createdAt };
    default:
      // system / bashExecution / 其他内部消息不展示
      return null;
  }
};

/**
 * 压缩记录的 `data` 同样来自会话文件：`reason` / `outcome` 非法就当没有记录（不瞎猜），
 * 其余字段按类型可选带上，缺字段不影响这条记录本身的意义。
 */
const compactionRecordOf = (data: unknown): CompactionRecord | null => {
  if (!isRecord(data)) return null;
  const { reason, outcome, tokensBefore, tokensAfter, keptFrom, skip, error, at } = data;
  if (
    typeof reason !== "string" ||
    !(COMPACTION_REASONS as readonly string[]).includes(reason) ||
    typeof outcome !== "string" ||
    !(COMPACTION_OUTCOMES as readonly string[]).includes(outcome) ||
    typeof at !== "string"
  ) {
    return null;
  }
  return {
    reason: reason as CompactionReason,
    outcome: outcome as CompactionOutcome,
    ...(typeof tokensBefore === "number" ? { tokensBefore } : {}),
    ...(typeof tokensAfter === "number" ? { tokensAfter } : {}),
    ...(typeof keptFrom === "string" ? { keptFrom } : {}),
    ...(typeof skip === "string" && (COMPACTION_SKIP_REASONS as readonly string[]).includes(skip)
      ? { skip: skip as CompactionSkipReason }
      : {}),
    ...(typeof error === "string" ? { error } : {}),
    at,
  };
};

/** 模式 / 权限档位的变更记录：`mode` / `permissionMode` 至少有一个，缺 `at` 视为损坏 */
export const modeRecordOf = (data: unknown): ModeRecord | null => {
  if (!isRecord(data)) return null;
  const { mode, permissionMode, at } = data;
  if (typeof at !== "string") return null;
  if (typeof mode !== "string" && typeof permissionMode !== "string") return null;
  return {
    ...(typeof mode === "string" ? { mode } : {}),
    ...(typeof permissionMode === "string" ? { permissionMode } : {}),
    at,
  };
};

/**
 * 技能记录的 `data` 同样不可信：`event` / `source` 不在枚举内、或缺少名字与路径就当没有记录。
 * `invoke` 与非法形状都不下发界面（`hit` 才带 `toolCallId`，界面靠它挂到那次 `read` 的卡片上）。
 */
const skillRecordOf = (data: unknown): SkillRecord | null => {
  if (!isRecord(data)) return null;
  const { event, name, file, source, toolCallId, at } = data;
  if (typeof event !== "string" || !(SKILL_RECORD_EVENTS as readonly string[]).includes(event)) {
    return null;
  }
  // `invoke` 只落文件：用户消息上的 chip 已经表达过显式调用，界面上再来一遍没有信息量
  if (event !== "hit") return null;
  if (typeof name !== "string" || typeof file !== "string" || typeof at !== "string") return null;
  if (
    typeof source !== "string" ||
    !(COMMAND_ASSET_SOURCES as readonly string[]).includes(source)
  ) {
    return null;
  }
  return {
    event,
    name,
    file,
    source: source as SkillRecord["source"],
    ...(typeof toolCallId === "string" ? { toolCallId } : {}),
    at,
  };
};

/**
 * 重试记录的 `data` 不可信：`event` 不在枚举内、`attempt` / `maxAttempts` 不是数字就当没有记录。
 * 重试成功（`end` 且 `success`）不下发：紧接着就是正常输出，界面多一行是噪音。
 */
const retryRecordOf = (data: unknown): RetryRecord | null => {
  if (!isRecord(data)) return null;
  const { event, attempt, maxAttempts, delayMs, errorMessage, success, at } = data;
  if (typeof event !== "string" || !(RETRY_RECORD_EVENTS as readonly string[]).includes(event)) {
    return null;
  }
  if (typeof attempt !== "number" || typeof maxAttempts !== "number" || typeof at !== "string") {
    return null;
  }
  if (event === "end" && success === true) return null;
  return {
    event: event as RetryRecord["event"],
    attempt,
    maxAttempts,
    ...(typeof delayMs === "number" ? { delayMs } : {}),
    ...(typeof errorMessage === "string" && errorMessage ? { errorMessage } : {}),
    ...(typeof success === "boolean" ? { success } : {}),
    at,
  };
};

/**
 * 目标记录的 `data` 同样不可信：`event` 不在枚举内就当没有记录；其余字段按类型带上。
 * 界面只看 `completed`，但字典要完整——`verdict` / `pause` 这些留给回溯。
 */
const goalRecordOf = (data: unknown): GoalRecord | null => {
  if (!isRecord(data)) return null;
  const { event, status, cause, turns, verdict, tokensUsed, objective, at } = data;
  if (
    typeof event !== "string" ||
    !(GOAL_RECORD_EVENTS as readonly string[]).includes(event) ||
    typeof at !== "string"
  ) {
    return null;
  }
  return {
    event: event as GoalRecordEvent,
    ...(status === "active" || status === "paused" || status === "completed" ? { status } : {}),
    ...(typeof cause === "string" ? { cause: cause as GoalPauseCause } : {}),
    ...(typeof turns === "number" ? { turns } : {}),
    ...(isRecord(verdict) && typeof verdict.reason === "string"
      ? {
          verdict: {
            achieved: verdict.achieved === true,
            reason: verdict.reason,
            nextStep: typeof verdict.nextStep === "string" ? verdict.nextStep : "",
          },
        }
      : {}),
    ...(typeof tokensUsed === "number" ? { tokensUsed } : {}),
    ...(typeof objective === "string" ? { objective } : {}),
    at,
  };
};

/**
 * 目标注入的条目带出来源（启动 / 续跑 / 恢复）：界面据此把那行写成「目标续跑 · 第 n 轮」。
 * 其它 `custom_message`（如计划批准）没有 details，靠 `customType` 就够。
 */
const goalPromptOf = (entry: {
  customType: string;
  details?: unknown;
}): { goalPrompt?: GoalPromptDetails } => {
  if (entry.customType !== GOAL_PROMPT_CUSTOM_TYPE || !isRecord(entry.details)) return {};
  const { kind, turn } = entry.details;
  if (typeof kind !== "string" || !(GOAL_PROMPT_KINDS as readonly string[]).includes(kind)) {
    return {};
  }
  return {
    goalPrompt: {
      kind: kind as GoalPromptKind,
      ...(typeof turn === "number" ? { turn } : {}),
    },
  };
};

/** 把会话条目转成前端 DTO；system 提示、usage、label 等内部条目会被过滤掉 */
export const entryToDTO = (entry: SessionEntry, state: TranscriptState = {}): MessageDTO | null => {
  const fallbackCreatedAt = isoOf(Date.parse(entry.timestamp));

  switch (entry.type) {
    case "message": {
      const dto = messageToDTO(entry.message, entry.id, fallbackCreatedAt, state);
      // assistant 的 message.timestamp 是开始生成的时刻，entry.timestamp 才是写完的时刻；
      // 回复耗时（见 MessageDTO.completedAt）需要后者，故一并带上
      if (dto?.role === "assistant" && fallbackCreatedAt) dto.completedAt = fallbackCreatedAt;
      return dto;
    }
    case "custom_message":
      return {
        id: entry.id,
        role: "custom",
        blocks: blocksOf(entry.content),
        customType: entry.customType,
        ...goalPromptOf(entry),
        createdAt: fallbackCreatedAt,
      };
    case "custom": {
      // 扩展条目默认不打开展示；只放行本项目的界面标记，其余 customType 的 data 不下发
      if (entry.customType === PERMISSION_DECISION_CUSTOM_TYPE) {
        const record = permissionRecordOf(entry.data);
        if (!record) return null;
        return {
          id: entry.id,
          role: "custom",
          blocks: [],
          customType: entry.customType,
          permissionDecision: record,
          createdAt: fallbackCreatedAt,
        };
      }
      if (entry.customType === COMPACTION_RECORD_CUSTOM_TYPE) {
        const record = compactionRecordOf(entry.data);
        if (!record) return null;
        return {
          id: entry.id,
          role: "custom",
          blocks: [],
          customType: entry.customType,
          compactionRecord: record,
          createdAt: fallbackCreatedAt,
        };
      }
      if (entry.customType === GOAL_RECORD_CUSTOM_TYPE) {
        const record = goalRecordOf(entry.data);
        if (!record) return null;
        return {
          id: entry.id,
          role: "custom",
          blocks: [],
          customType: entry.customType,
          goalRecord: record,
          createdAt: fallbackCreatedAt,
        };
      }
      // 设置点不发给客户端：界面不展示，`transcriptStates` 也不再推进它；
      // 它只供打开已有会话时校准 `app.db`（见 `./run-settings`）
      if (entry.customType === MODE_RECORD_CUSTOM_TYPE) return null;
      if (entry.customType === SKILL_RECORD_CUSTOM_TYPE) {
        const record = skillRecordOf(entry.data);
        if (!record) return null;
        return {
          id: entry.id,
          role: "custom",
          blocks: [],
          customType: entry.customType,
          skillRecord: record,
          createdAt: fallbackCreatedAt,
        };
      }
      if (entry.customType === RETRY_RECORD_CUSTOM_TYPE) {
        const record = retryRecordOf(entry.data);
        if (!record) return null;
        return {
          id: entry.id,
          role: "custom",
          blocks: [],
          customType: entry.customType,
          retryRecord: record,
          createdAt: fallbackCreatedAt,
        };
      }
      if (entry.customType !== PLAN_IGNORED_CUSTOM_TYPE) return null;
      return {
        id: entry.id,
        role: "custom",
        blocks: [],
        customType: entry.customType,
        createdAt: fallbackCreatedAt,
      };
    }
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
 * 最新一次压缩的条目 id：pi 的 `buildContextEntries()` 把最新压缩条目放在**首位**，
 * 更早的压缩条目只会作为保留区间的普通条目跟在后面（它们对模型已不可见），
 * 所以这里取第一条，而不是最后一条。没有压缩过时为 undefined。
 */
const newestCompactionIdOf = (entries: SessionEntry[]): string | undefined =>
  entries.find((entry) => entry.type === "compaction")?.id;

/**
 * 把展示用的条目转成前端 DTO；`states` 提供每条条目生效时的会话级设置
 * （由 `transcriptStates` 从全量路径算出，见其说明）。
 * system 提示、usage、label 等内部条目会被过滤掉。
 *
 * 只下发**最新**一次压缩的分隔标记：更早的压缩条目会落在外层保留区间里（pi 的
 * `buildContextEntries()` 一并带出，排在最新那条之后），但它们对模型已经不可见
 * （见 pi 的 `buildSessionProjection()` 与 `session-format.md`），展示出来只会多出一条没有意义的「已压缩」。
 */
export const entriesToDTO = (
  entries: SessionEntry[],
  states: ReadonlyMap<string, TranscriptState>,
): MessageDTO[] => {
  const newestCompactionId = newestCompactionIdOf(entries);
  const messages: MessageDTO[] = [];
  for (const entry of entries) {
    if (entry.type === "compaction" && entry.id !== newestCompactionId) continue;
    const dto = entryToDTO(entry, states.get(entry.id) ?? {});
    if (dto) messages.push(dto);
  }
  return messages;
};

/**
 * 列表 / 事件共用的运行态：`running` 是「有活跃生成」的粗粒度布尔，
 * `status` 是面向用户的细分状态（等待授权 / 回答时 `running` 仍为真）。
 */
export type SessionRuntimeState = {
  running: boolean;
  status: SessionStatus;
};

export const sessionInfoToDTO = (
  info: SessionInfo,
  override: SessionOverride,
  defaultModel: string | null,
  /** 实际生效的思考档位（`auto` 已解析） */
  resolvedThinkingLevel: ThinkingLevel,
  runtime: SessionRuntimeState,
  childCount: number,
): SessionSummary => ({
  id: info.id,
  name: info.name ?? override.name ?? null,
  cwd: info.cwd,
  createdAt: info.created.toISOString(),
  updatedAt: info.modified.toISOString(),
  preview: info.firstMessage ?? "",
  model: override.model ?? defaultModel,
  thinkingLevel: override.thinkingLevel ?? DEFAULT_THINKING_PREFERENCE,
  resolvedThinkingLevel,
  mode: override.mode ?? DEFAULT_SESSION_MODE,
  permissionMode: override.permissionMode ?? DEFAULT_PERMISSION_MODE,
  parentSessionId: override.parentSessionId ?? null,
  agent: override.agent ?? null,
  forkedFromId: override.forkedFromId ?? null,
  childCount,
  running: runtime.running,
  status: runtime.status,
  pinnedAt: override.pinnedAt ?? null,
  lastReadAt: override.lastReadAt ?? null,
  deletedAt: override.deletedAt ?? null,
});

/** 还没落盘（没有 assistant 回复）的草稿会话；草稿也可能正在生成首轮回复 */
export const draftSessionSummary = (
  sessionId: string,
  override: SessionOverride,
  defaultModel: string | null,
  /** 实际生效的思考档位（`auto` 已解析） */
  resolvedThinkingLevel: ThinkingLevel,
  /** 覆盖值与会话工作区都缺失时的兜底（全局工作目录） */
  fallbackCwd: string,
  runtime: SessionRuntimeState,
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
    thinkingLevel: override.thinkingLevel ?? DEFAULT_THINKING_PREFERENCE,
    resolvedThinkingLevel,
    mode: override.mode ?? DEFAULT_SESSION_MODE,
    permissionMode: override.permissionMode ?? DEFAULT_PERMISSION_MODE,
    parentSessionId: override.parentSessionId ?? null,
    agent: override.agent ?? null,
    forkedFromId: override.forkedFromId ?? null,
    childCount,
    running: runtime.running,
    status: runtime.status,
    pinnedAt: override.pinnedAt ?? null,
    lastReadAt: override.lastReadAt ?? null,
    deletedAt: override.deletedAt ?? null,
  };
};
