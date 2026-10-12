/**
 * 单个会话流的引擎：消息列表、生成态与子智能体进度的 store，以及事件归并。
 * 由 `createSessionStreams` 按 sessionId 复用。
 */
import type { BackgroundService, CompactionNotice, ServerEventPayload } from "@ucode/contracts";

import type { ApiError } from "../../error";
import { createStore, type Store } from "../../store";
import type { ChatItem, PromptPayload, SubagentStreams } from "../../types";
import {
  asRecord,
  attachAssistantTiming,
  compactionNoticeOf,
  reduceEvent,
  settle,
} from "./reducer";

/** 会让界面进入「生成中」的事件；agent_settled 是唯一的结束边界 */
const ACTIVITY_EVENTS: ReadonlySet<string> = new Set([
  "message_start",
  "text_delta",
  "thinking_delta",
  "tool_call",
  "tool_start",
  "tool_update",
  "tool_end",
  "message_end",
  "queue_update",
  "compaction_start",
  "compaction_end",
]);

export type SessionStreamState = {
  items: ChatItem[];
  running: boolean;
  /**
   * 正在压缩上下文：压缩不产出消息，进度只能靠独立标记表达（列表尾部据此换文案）
   */
  compacting: boolean;
  /**
   * 压缩的结果提示（正常拒绝 / 自动压缩失败）：界面弹过一条轻提示后由 `ackCompactionNotice` 清掉，
   * 避免重连或重渲染时重复弹
   */
  compactionNotice: CompactionNotice | null;
  /** 已受理、还没收到首个活动事件：消息区尾部显示等待指示 */
  pending: boolean;
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents: SubagentStreams;
  /**
   * 本会话观测到的后台服务（bash 起的服务，按端口一条）。
   * 服务端下发全量帧，所以这边不做增量归并，收到即整份替换。
   */
  services: BackgroundService[];
  loadingHistory: boolean;
  error: ApiError | null;
};

/** 每个会话的引擎：store 之外还有取快照所需的一次性状态 */
export type Engine = {
  store: Store<SessionStreamState>;
  token: number;
  hydrating: boolean;
  buffer: ServerEventPayload[];
  childToolCalls: Map<string, string>;
  /** 是否已取过快照；新建会话为「已知空历史」，避免切换时再拉一次 */
  hydrated: boolean;
  /** 当前 assistant 消息的思考计时，用于测算思考耗时；不落盘 */
  stream: StreamTiming | null;
};

/** 当前 assistant 消息的思考计时：一段思考的起点用 `null` 表示不在思考中，`thinkingMs` 为已累计耗时 */
type StreamTiming = {
  thinkingStartedAt: number | null;
  thinkingMs: number;
};

export const EMPTY_STATE: SessionStreamState = {
  items: [],
  running: false,
  compacting: false,
  compactionNotice: null,
  pending: false,
  subagents: {},
  services: [],
  loadingHistory: false,
  error: null,
};

export const createEngine = (): Engine => ({
  store: createStore(EMPTY_STATE),
  token: 0,
  hydrating: false,
  buffer: [],
  childToolCalls: new Map(),
  hydrated: false,
  stream: null,
});

/** 仅当字段真的变化时才替换快照，避免未知事件返回同一 items 引用时的无意义通知 */
export const patch = (engine: Engine, next: Partial<SessionStreamState>): void => {
  engine.store.setState((prev) => {
    let changed = false;
    for (const key of Object.keys(next) as Array<keyof SessionStreamState>) {
      if (!Object.is(prev[key], next[key])) {
        changed = true;
        break;
      }
    }
    return changed ? { ...prev, ...next } : prev;
  });
};

/**
 * 载荷 → 乐观区块：只放正文。
 *
 * 附件与引用在正文里都是位置标记（`图片 N` / `附件 N.<ext>` / `@路径`），真实内容要等服务端
 * 展开——而载荷只带附件 id，这里造不出名称与类型。与其编一个假的，不如先按标记原样显示，
 * 权威消息（几十毫秒后到达）会把同一条消息换成带 chip 的样子。
 */
export const optimisticBlocks = (payload: PromptPayload) =>
  payload.text ? [{ type: "text", text: payload.text } as const] : [];

/** 就地更新某个子智能体的进度；没有对应条目时忽略 */
const updateSubagent = (
  engine: Engine,
  toolCallId: string,
  update: (stream: SubagentStreams[string]) => SubagentStreams[string],
): void => {
  const current = engine.store.getState().subagents;
  const existing = current[toolCallId];
  if (!existing) return;
  patch(engine, { subagents: { ...current, [toolCallId]: update(existing) } });
};

/** 子会话自身的帧经关联后归入对应嵌套视图；`agent_settled` 表示它已经跑完 */
export const applyChildFrame = (
  engine: Engine,
  toolCallId: string,
  frame: ServerEventPayload,
): void => {
  updateSubagent(engine, toolCallId, (stream) =>
    frame.type === "agent_settled"
      ? { ...stream, items: settle(stream.items), done: true }
      : { ...stream, items: reduceEvent(stream.items, frame.type, frame.data) },
  );
};

/**
 * 全量服务清单（事件帧与快照共用）：载荷不可信，非数组或缺失一律当作「没有服务」。
 * 服务清单是整份替换的运行态，缺了只会让面板少一段，不该让界面崩掉。
 */
export const asServices = (data: unknown): BackgroundService[] =>
  Array.isArray(data) ? (data as BackgroundService[]) : [];

/** 按事件到达时间维护当前 assistant 消息的思考计时；返回本帧可挂到条目上的耗时字段 */
const trackStreamTiming = (engine: Engine, frame: ServerEventPayload): { thinkingMs?: number } => {
  const now = Date.now();
  const stream = engine.stream;

  switch (frame.type) {
    case "message_start": {
      const data = asRecord(frame.data);
      engine.stream = data.role === "assistant" ? { thinkingStartedAt: null, thinkingMs: 0 } : null;
      return {};
    }
    case "thinking_delta": {
      if (stream && stream.thinkingStartedAt === null) {
        engine.stream = { ...stream, thinkingStartedAt: now };
      }
      return {};
    }
    // 一段思考以「首个正文 / 工具调用」为界；结束后仍可能再进入思考，故累计而不是取单段
    case "text_delta":
    case "tool_call": {
      if (!stream || stream.thinkingStartedAt === null) return {};
      const thinkingMs = stream.thinkingMs + (now - stream.thinkingStartedAt);
      engine.stream = { ...stream, thinkingStartedAt: null, thinkingMs };
      return { thinkingMs };
    }
    case "message_end": {
      if (!stream) return {};
      const thinkingMs =
        stream.thinkingStartedAt !== null
          ? stream.thinkingMs + (now - stream.thinkingStartedAt)
          : stream.thinkingMs;
      engine.stream = null;
      // 权威消息会把实时条目替换掉（丢 timing），这里再挂一次最终值
      if (asRecord(frame.data).role !== "assistant" || thinkingMs <= 0) return {};
      return { thinkingMs };
    }
    default:
      return {};
  }
};

/** 应用一条事件帧：维护生成态与子智能体，再交给 reducer 归并 */
export const applyFrame = (engine: Engine, frame: ServerEventPayload): void => {
  // 子智能体只发关联帧：建立 / 解除 childId → toolCallId 映射，进度靠子会话自身的帧
  if (frame.type === "subagent_start") {
    const data = asRecord(frame.data);
    const toolCallId = String(data.toolCallId ?? "");
    const childId = String(data.sessionId ?? "");
    if (!toolCallId || !childId) return;
    engine.childToolCalls.set(childId, toolCallId);
    const current = engine.store.getState().subagents;
    patch(engine, {
      subagents: {
        ...current,
        [toolCallId]: {
          sessionId: childId,
          description: String(data.description ?? ""),
          items: current[toolCallId]?.items ?? [],
          done: false,
          isError: false,
        },
      },
    });
    return;
  }

  if (frame.type === "subagent_end") {
    const data = asRecord(frame.data);
    const toolCallId = String(data.toolCallId ?? "");
    const childId = String(data.sessionId ?? "");
    if (childId) engine.childToolCalls.delete(childId);
    updateSubagent(engine, toolCallId, (stream) => ({
      ...stream,
      items: settle(stream.items),
      done: true,
      isError: Boolean(data.isError),
    }));
    return;
  }

  if (frame.type === "service_update") {
    patch(engine, { services: asServices(frame.data) });
    return;
  }

  if (frame.type === "agent_settled") {
    const state = engine.store.getState();
    // 父会话整体收尾时，残留的子智能体一并收尾（正常路径 subagent_end 已收）
    const leftovers = Object.entries(state.subagents).filter(
      ([, stream]) => !stream.done || stream.items.some((item) => item.live),
    );
    const subagents =
      leftovers.length > 0
        ? {
            ...state.subagents,
            ...Object.fromEntries(
              leftovers.map(([id, stream]) => [
                id,
                { ...stream, items: settle(stream.items), done: true },
              ]),
            ),
          }
        : state.subagents;
    patch(engine, {
      running: false,
      compacting: false,
      compactionNotice: null,
      pending: false,
      items: settle(state.items),
      subagents,
    });
    return;
  }

  // 首个活动事件到达即接手生成态，pending 让位给 running
  if (ACTIVITY_EVENTS.has(frame.type)) {
    patch(engine, { running: true, pending: false });
  }

  // 压缩不产出消息：只维护压缩标记与「被正常拒绝」的原因（后者供界面弹一条轻提示）
  if (frame.type === "compaction_start") {
    patch(engine, { compacting: true });
    return;
  }
  if (frame.type === "compaction_end") {
    const data = asRecord(frame.data);
    // 手动压缩是一轮独立的服务端动作，**不会**再有 `agent_settled` 收尾：
    // 就地结束「生成中」，否则被拒绝时界面会永远停在「工作中」（成功的另一条路会再由快照校正一次）。
    // 自动压缩（threshold / overflow）发生在生成轮中途，由后续事件继续驱动，不动它的运行态
    const manual = data.reason === "manual";
    const notice = compactionNoticeOf(data, manual);
    patch(engine, {
      compacting: false,
      ...(manual ? { running: false, pending: false } : {}),
      ...(notice ? { compactionNotice: notice } : {}),
    });
    return;
  }

  // 记录思考耗时（仅本次运行内可见，快照重建后丢失）
  const timing = trackStreamTiming(engine, frame);
  let items = reduceEvent(engine.store.getState().items, frame.type, frame.data);
  if (timing.thinkingMs !== undefined) {
    items = attachAssistantTiming(items, { thinkingMs: timing.thinkingMs });
  }
  patch(engine, { items });
};
