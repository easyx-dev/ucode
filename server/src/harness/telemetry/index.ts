/**
 * 每步耗时归因：把「一次模型往返」拆开记下来，供事后算账。
 *
 * 起因很具体：想回答「为什么一轮要十分钟」，只有消息时间戳可用时，只能拿
 * 「上一条消息到这一条」的差值硬算——模型慢、工具慢、harness 慢三件事混在一个数里，
 * 拆不开就无从优化。这里用 pi 已经发出来的事件锚点补齐三段：
 *
 * - `turn_start → 首个 token`：供应商首 token 延迟（含网络与排队）；
 * - `首个 token → message_end`：流式解码；
 * - `message_end → turn_end`：工具执行；
 * - 另有「等用户」的时间单独累计（审批 / 提问挂起期间），不从系统耗时里混进来。
 *
 * 记录写进会话 JSONL 的自定义条目（`STEP_RECORD_CUSTOM_TYPE`）：不进模型上下文
 * （与权限审批记录同一处理方式），与消息同源便于按步对齐，也能直接扫会话文件做统计。
 */
import type { AgentSessionEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import { STEP_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { logger } from "../../lib/logger";

/** 条目类型由契约声明（与权限审批记录同族）；这里再导出一次，调用方不必多带一个依赖 */
export const STEP_CUSTOM_TYPE = STEP_RECORD_CUSTOM_TYPE;

export type StepRecord = {
  /** 本次装配内第几次模型往返，从 1 开始；会话被回收重装后重新计数 */
  turn: number;
  startedAt: number;
  /** 供应商第一个流事件的时间；没等到就为空 */
  firstTokenAt: number | null;
  respondedAt: number | null;
  endedAt: number;
  ttftMs: number | null;
  streamMs: number | null;
  toolMs: number | null;
  /** 本轮等用户的时间（审批 / 提问挂起） */
  userWaitMs: number;
  toolCalls: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** 本轮请求面对的上下文规模（input + cacheRead） */
  contextTokens: number;
  /** 该会话当前的压缩触发点；未知为空 */
  contextBudget: number | null;
  /** 随消息进入上下文的媒体：只记数量与字节，字节按 base64 长度粗算 */
  attachments: { images: number; bytes: number };
};

type StepState = {
  turn: number;
  startedAt: number;
  firstTokenAt: number | null;
  respondedAt: number | null;
  toolCalls: number;
  usage: { input: number; cacheRead: number; output: number; reasoning: number };
  attachments: { images: number; bytes: number };
  userWaitMs: number;
  waitingSince: number | null;
  budget: number | null;
};

const readNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const readString = (value: unknown): string => (typeof value === "string" ? value : "");

/** 从消息里取用量与媒体：解析 assistant 消息的形状（pi 的类型是联合，按记录读） */
const readMessage = (
  message: unknown,
): { usage: StepState["usage"]; toolCalls: number; attachments: StepState["attachments"] } => {
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
  const attachments = { images: 0, bytes: 0 };
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (typeof block !== "object" || block === null) continue;
      const item = block as { type?: unknown; data?: unknown };
      if (item.type === "toolCall") toolCalls += 1;
      if (item.type === "image") {
        attachments.images += 1;
        attachments.bytes += readString(item.data).length;
      }
    }
  }
  return { usage, toolCalls, attachments };
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
      firstTokenAt: null,
      respondedAt: null,
      toolCalls: 0,
      usage: { input: 0, cacheRead: 0, output: 0, reasoning: 0 },
      attachments: { images: 0, bytes: 0 },
      userWaitMs: 0,
      waitingSince: null,
      budget,
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
  observe(sessionId: string, event: AgentSessionEvent, manager: SessionManager): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    switch (event.type) {
      case "turn_start": {
        state.turn += 1;
        state.startedAt = this.now();
        state.firstTokenAt = null;
        state.respondedAt = null;
        state.toolCalls = 0;
        state.usage = { input: 0, cacheRead: 0, output: 0, reasoning: 0 };
        state.attachments = { images: 0, bytes: 0 };
        state.userWaitMs = state.waitingSince === null ? 0 : state.userWaitMs;
        return;
      }
      case "message_update": {
        const inner = (event as { assistantMessageEvent?: { type?: unknown } })
          .assistantMessageEvent;
        if (inner?.type === "start" && state.firstTokenAt === null) {
          state.firstTokenAt = this.now();
        }
        return;
      }
      case "message_end": {
        const message = (event as { message?: { role?: unknown } }).message;
        if (message?.role !== "assistant") return;
        state.respondedAt = this.now();
        const parsed = readMessage(message);
        state.usage = parsed.usage;
        state.toolCalls = parsed.toolCalls;
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
    const ttftMs = state.firstTokenAt === null ? null : state.firstTokenAt - state.startedAt;
    const streamMs =
      state.firstTokenAt === null || state.respondedAt === null
        ? null
        : state.respondedAt - state.firstTokenAt;
    const toolMs = state.respondedAt === null ? null : endedAt - state.respondedAt;
    const record: StepRecord = {
      turn: state.turn,
      startedAt: state.startedAt,
      firstTokenAt: state.firstTokenAt,
      respondedAt: state.respondedAt,
      endedAt,
      ttftMs,
      streamMs,
      toolMs,
      userWaitMs: state.userWaitMs,
      toolCalls: state.toolCalls,
      inputTokens: state.usage.input,
      cacheReadTokens: state.usage.cacheRead,
      outputTokens: state.usage.output,
      reasoningTokens: state.usage.reasoning,
      contextTokens: state.usage.input + state.usage.cacheRead,
      contextBudget: state.budget,
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
