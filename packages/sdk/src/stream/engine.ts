/**
 * 单个会话流的引擎：消息列表、生成态与子智能体进度的 store，以及事件归并。
 * 由 `createSessionStreams` 按 sessionId 复用。
 */
import type { ServerEventPayload } from "@ucode/contracts";

import { asRecord, reduceEvent, settle } from "../chat-reducer";
import type { UcodeClient } from "../client";
import { createStore, type Store } from "../store";
import type { ChatItem, PromptPayload, SubagentStreams } from "../types";

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
  /** 已受理、还没收到首个活动事件：消息区尾部显示等待指示 */
  pending: boolean;
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents: SubagentStreams;
  loadingHistory: boolean;
  error: string | null;
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
};

export const EMPTY_STATE: SessionStreamState = {
  items: [],
  running: false,
  pending: false,
  subagents: {},
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

/** 载荷 → 乐观区块：正文 + 附件（图片直接用附件路由的地址预览，权威消息到达后替换） */
export const optimisticBlocks = (client: UcodeClient, payload: PromptPayload) => [
  ...(payload.text ? [{ type: "text", text: payload.text } as const] : []),
  ...payload.attachments.map((attachment) => {
    const url = client.attachmentUrl(attachment.id);
    if (attachment.kind === "image") {
      return {
        type: "image" as const,
        id: attachment.id,
        mimeType: attachment.mimeType,
        url,
      };
    }
    return {
      type: "file" as const,
      id: attachment.id,
      mimeType: attachment.mimeType,
      name: attachment.name ?? attachment.id,
      size: attachment.size,
      url,
    };
  }),
];

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
  patch(engine, {
    items: reduceEvent(engine.store.getState().items, frame.type, frame.data),
  });
};
