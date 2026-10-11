/**
 * 每步耗时归因：把「一次模型往返」拆开记下来，供事后算账。
 *
 * 起因很具体：想回答「为什么一轮要十分钟」，只有消息时间戳可用时，只能拿
 * 「上一条消息到这一条」的差值硬算——模型慢、工具慢、harness 慢三件事混在一个数里，
 * 拆不开就无从优化。这里用 pi 已经发出来的事件锚点补齐四段：
 *
 * - `turn_start → message_start`：请求发出到响应头到达（含上传与上游排队）；
 * - `message_start → 首个内容帧`：响应头之后到真正开始吐字之间的静默，推理模型的长思考落在这里；
 * - `首个内容帧 → message_end`：流式解码；
 * - `message_end → turn_end`：工具执行；
 * - 另有「等用户」的时间单独累计（审批 / 提问挂起期间），不从系统耗时里混进来。
 *
 * 锚点形状容易搞错：pi 的 `start` 帧走的是 `message_start` 事件，`message_update` 只承载内容帧
 * （text / thinking / toolCall 的 start / delta / end）——等 `message_update` 里的 `start`
 * 永远等不到，首 token 与解码两段会一直是空值。
 *
 * 记录写进会话 JSONL 的自定义条目（`STEP_RECORD_CUSTOM_TYPE`）：不进模型上下文
 * （与权限审批记录同一处理方式），与消息同源便于按步对齐，也能直接扫会话文件做统计。
 */
import type { AgentSessionEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import { STEP_RECORD_CUSTOM_TYPE, type ThinkingLevel } from "@ucode/contracts";

import { logger } from "../../../platform/logger";

/** 条目类型由契约声明（与权限审批记录同族）；这里再导出一次，调用方不必多带一个依赖 */
export const STEP_CUSTOM_TYPE = STEP_RECORD_CUSTOM_TYPE;

export type StepRecord = {
  /** 本次装配内第几次模型往返，从 1 开始；会话被回收重装后重新计数 */
  turn: number;
  startedAt: number;
  /** 首个流事件（响应头到达）的时刻；没等到就为空 */
  firstEventAt: number | null;
  /** 首个内容帧（text / thinking / toolCall 的第一个增量）的时刻；没等到就为空 */
  firstTokenAt: number | null;
  respondedAt: number | null;
  endedAt: number;
  /** 请求发出 → 响应头到达：含请求上传与上游排队 */
  firstEventMs: number | null;
  /** 请求发出 → 首个内容帧：响应头之后到真正开始吐字之间的静默 */
  ttftMs: number | null;
  /** 首个内容帧 → message_end：流式解码 */
  streamMs: number | null;
  toolMs: number | null;
  /** 本轮等用户的时间（审批 / 提问挂起） */
  userWaitMs: number;
  toolCalls: number;
  /** 本步调用的工具名，按首次出现的顺序去重 */
  toolNames: string[];
  /** 本步 assistant 是否产出了文本；只有工具调用时为 false，据此可区分执行步与汇报步 */
  hasText: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** 本轮请求面对的上下文规模（input + cacheRead） */
  contextTokens: number;
  /** 该会话当前的压缩触发点；未知为空 */
  contextBudget: number | null;
  /** 本步生效的思考档位；未知为空 */
  thinkingLevel: ThinkingLevel | null;
  /** 随消息进入上下文的媒体：只记数量与字节，字节按 base64 长度粗算 */
  attachments: { images: number; bytes: number };
};

type StepState = {
  turn: number;
  startedAt: number;
  firstEventAt: number | null;
  firstTokenAt: number | null;
  respondedAt: number | null;
  toolCalls: number;
  toolNames: string[];
  hasText: boolean;
  usage: { input: number; cacheRead: number; output: number; reasoning: number };
  attachments: { images: number; bytes: number };
  userWaitMs: number;
  waitingSince: number | null;
  budget: number | null;
  thinkingLevel: ThinkingLevel | null;
};

const readNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const readString = (value: unknown): string => (typeof value === "string" ? value : "");

/** 从消息里取用量、工具与媒体：解析 assistant 消息的形状（pi 的类型是联合，按记录读） */
const readMessage = (
  message: unknown,
): {
  usage: StepState["usage"];
  toolCalls: number;
  toolNames: string[];
  hasText: boolean;
  attachments: StepState["attachments"];
} => {
  const record = (message ?? {}) as {
    usage?: Record<string, unknown>;
    content?: unknown;
  };
  const usage = {
    input: readNumber(record.usage?.input),
    cacheRead: readNumber(record.usage?.cacheRead),
    output: readNumber(record.usage?.output),
    reasoning: readNumber(record.usage?.reasoning),
  };
  let toolCalls = 0;
  let hasText = false;
  const toolNames: string[] = [];
  const attachments = { images: 0, bytes: 0 };
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (typeof block !== "object" || block === null) continue;
      const item = block as { type?: unknown; data?: unknown; name?: unknown; text?: unknown };
      if (item.type === "toolCall") {
        toolCalls += 1;
        const name = readString(item.name);
        if (name && !toolNames.includes(name)) toolNames.push(name);
      }
      if (item.type === "text" && !hasText) hasText = readString(item.text).length > 0;
      if (item.type === "image") {
        attachments.images += 1;
        attachments.bytes += readString(item.data).length;
      }
    }
  }
  return { usage, toolCalls, toolNames, hasText, attachments };
};

export class StepTelemetry {
  private readonly sessions = new Map<string, StepState>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 会话装配完成时告知它当前的压缩触发点，写进后续每步记录 */
  attach(sessionId: string, budget: number | null): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.budget = budget;
      return;
    }
    this.sessions.set(sessionId, {
      turn: 0,
      startedAt: this.now(),
      firstEventAt: null,
      firstTokenAt: null,
      respondedAt: null,
      toolCalls: 0,
      toolNames: [],
      hasText: false,
      usage: { input: 0, cacheRead: 0, output: 0, reasoning: 0 },
      attachments: { images: 0, bytes: 0 },
      userWaitMs: 0,
      waitingSince: null,
      budget,
      thinkingLevel: null,
    });
  }

  detach(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** 交互请求出现：开始计入「等用户」 */
  beginUserWait(sessionId: string, at: number): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.waitingSince !== null) return;
    state.waitingSince = at;
  }

  /** 交互请求结算：把这段时间记到本轮 */
  endUserWait(sessionId: string, at: number): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.waitingSince === null) return;
    state.userWaitMs += Math.max(0, at - state.waitingSince);
    state.waitingSince = null;
  }

  /**
   * 观察一条 pi 事件。只认四类锚点，其余一律忽略——订阅回调在热路径上，不做多余的工作。
   * 落条目的失败不能影响会话本身，所以全程 best-effort。
   */
  observe(
    sessionId: string,
    event: AgentSessionEvent,
    manager: SessionManager,
    thinkingLevel: ThinkingLevel | null = null,
  ): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    switch (event.type) {
      case "turn_start": {
        state.turn += 1;
        state.startedAt = this.now();
        state.firstEventAt = null;
        state.firstTokenAt = null;
        state.respondedAt = null;
        state.toolCalls = 0;
        state.toolNames = [];
        state.hasText = false;
        state.usage = { input: 0, cacheRead: 0, output: 0, reasoning: 0 };
        state.attachments = { images: 0, bytes: 0 };
        state.userWaitMs = state.waitingSince === null ? 0 : state.userWaitMs;
        state.thinkingLevel = thinkingLevel;
        return;
      }
      case "message_start": {
        // 供应商收到请求并回了响应头；到这一步为止的耗时是上传与排队
        if (state.firstEventAt === null) state.firstEventAt = this.now();
        return;
      }
      case "message_update": {
        // 任何内容帧都算「开始吐字」：pi 只在 partial 消息已建立后才发这个事件
        if (state.firstTokenAt === null) state.firstTokenAt = this.now();
        return;
      }
      case "message_end": {
        const message = (event as { message?: { role?: unknown } }).message;
        if (message?.role !== "assistant") return;
        state.respondedAt = this.now();
        const parsed = readMessage(message);
        state.usage = parsed.usage;
        state.toolCalls = parsed.toolCalls;
        state.toolNames = parsed.toolNames;
        state.hasText = parsed.hasText;
        state.attachments = parsed.attachments;
        return;
      }
      case "turn_end": {
        this.flush(sessionId, state, manager, this.now());
        return;
      }
      default:
        return;
    }
  }

  private flush(
    sessionId: string,
    state: StepState,
    manager: SessionManager,
    endedAt: number,
  ): void {
    if (state.turn === 0) return;
    const firstEventMs = state.firstEventAt === null ? null : state.firstEventAt - state.startedAt;
    const ttftMs = state.firstTokenAt === null ? null : state.firstTokenAt - state.startedAt;
    const streamMs =
      state.firstTokenAt === null || state.respondedAt === null
        ? null
        : state.respondedAt - state.firstTokenAt;
    const toolMs = state.respondedAt === null ? null : endedAt - state.respondedAt;
    const record: StepRecord = {
      turn: state.turn,
      startedAt: state.startedAt,
      firstEventAt: state.firstEventAt,
      firstTokenAt: state.firstTokenAt,
      respondedAt: state.respondedAt,
      endedAt,
      firstEventMs,
      ttftMs,
      streamMs,
      toolMs,
      userWaitMs: state.userWaitMs,
      toolCalls: state.toolCalls,
      toolNames: [...state.toolNames],
      hasText: state.hasText,
      inputTokens: state.usage.input,
      cacheReadTokens: state.usage.cacheRead,
      outputTokens: state.usage.output,
      reasoningTokens: state.usage.reasoning,
      contextTokens: state.usage.input + state.usage.cacheRead,
      contextBudget: state.budget,
      thinkingLevel: state.thinkingLevel,
      attachments: state.attachments,
    };
    try {
      manager.appendCustomEntry(STEP_CUSTOM_TYPE, record);
    } catch (error) {
      logger.warn({ sessionId, error }, "写入每步耗时记录失败");
      return;
    }
    logger.debug(
      {
        sessionId,
        turn: record.turn,
        firstEventMs,
        ttftMs,
        streamMs,
        toolMs,
        toolCalls: record.toolCalls,
        contextTokens: record.contextTokens,
      },
      "模型往返耗时",
    );
  }
}
