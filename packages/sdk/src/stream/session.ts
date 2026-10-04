/**
 * 会话消息流管理器：按 sessionId 维护引擎、路由全局事件、负责取快照与发送。
 *
 * 每个会话一个 store，全局事件流按 sessionId 路由帧，因此后台会话也能保持最新；
 * React 侧只订阅 store，不关心连接与归并细节。
 */
import type { ServerEventPayload } from "@ucode/contracts";

import { appendUserItem, removeUserItem } from "../chat-reducer";
import type { UcodeClient } from "../client";
import { describeApiError, describeError, type Translate } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";
import type { PromptPayload } from "../types";
import {
  applyChildFrame,
  applyFrame,
  createEngine,
  EMPTY_STATE,
  type Engine,
  optimisticBlocks,
  patch,
  type SessionStreamState,
} from "./engine";

export type { SessionStreamState } from "./engine";

export type SessionStreams = {
  /** 取某个会话的 store；sessionId 为 null 时返回共享的空 store */
  get: (sessionId: string | null) => Store<SessionStreamState>;
  /** 标记会话为当前激活：首次激活时取快照 */
  activate: (sessionId: string | null) => void;
  /** 登记一个刚建好的空会话：已知无历史，避免切换时多余地取快照 */
  seed: (sessionId: string) => void;
  /** 强制取一次快照（如首条消息受理后，用权威条目替换乐观消息） */
  refresh: (sessionId: string) => void;
  /** 发送一条消息并乐观插入；返回是否被服务端受理 */
  send: (sessionId: string, payload: PromptPayload) => Promise<boolean>;
  /** 编辑一条用户消息并重发；刷新由 transcript_reset 事件驱动 */
  edit: (sessionId: string, entryId: string, text: string) => Promise<boolean>;
  /** 中断当前生成 */
  interrupt: (sessionId: string) => Promise<void>;
};

type SessionStreamDeps = {
  client: UcodeClient;
  events: EventStream;
  translate?: Translate;
};

export const createSessionStreams = (deps: SessionStreamDeps): SessionStreams => {
  const engines = new Map<string, Engine>();
  const emptyStore = createStore(EMPTY_STATE);
  let connectedOnce = false;

  const ensure = (sessionId: string): Engine => {
    const existing = engines.get(sessionId);
    if (existing) return existing;
    const engine = createEngine();
    engines.set(sessionId, engine);
    return engine;
  };

  /**
   * 取快照并接续。服务端把投影与快照序号放在同一次同步读取里返回，
   * 所以「丢弃 seq <= 快照序号的缓冲帧、应用其余帧」即可无缝衔接。
   */
  const hydrate = async (sessionId: string, engine: Engine): Promise<void> => {
    const token = engine.token + 1;
    engine.token = token;
    engine.hydrating = true;
    engine.buffer = [];
    patch(engine, { loadingHistory: true });

    try {
      const snapshot = await deps.client.messages.list(sessionId);
      if (token !== engine.token) return;

      patch(engine, {
        items: snapshot.messages.map((message) => ({
          ...message,
          live: message.id === snapshot.liveMessageId,
        })),
        running: snapshot.running,
        pending: false,
        error: null,
      });

      const buffered = engine.buffer;
      engine.buffer = [];
      engine.hydrating = false;
      engine.hydrated = true;
      for (const frame of buffered) {
        if (frame.seq <= snapshot.seq) continue;
        applyFrame(engine, frame);
      }
    } catch (error) {
      if (token === engine.token) {
        patch(engine, { error: describeError(error, deps.translate) });
      }
    } finally {
      if (token === engine.token) {
        engine.hydrating = false;
        patch(engine, { loadingHistory: false });
      }
    }
  };

  /** 收到会话事件：找到对应引擎，未激活的历史帧丢弃；子会话帧归入父引擎 */
  const routeFrame = (frame: ServerEventPayload): void => {
    const engine = engines.get(frame.sessionId);
    if (!engine) {
      for (const candidate of engines.values()) {
        const toolCallId = candidate.childToolCalls.get(frame.sessionId);
        if (!toolCallId) continue;
        // 快照对嵌套进度不做重建，取快照期间直接丢弃
        if (candidate.hydrating) return;
        applyChildFrame(candidate, toolCallId, frame);
        return;
      }
      return;
    }

    // 活动分支变了：本地历史作废，重新取快照（token 守卫会作废在途的旧快照）
    if (frame.type === "transcript_reset") {
      void hydrate(frame.sessionId, engine);
      return;
    }
    if (engine.hydrating) {
      engine.buffer.push(frame);
      return;
    }
    applyFrame(engine, frame);
  };

  deps.events.subscribe((frame) => {
    if (frame.type === "server.connected") return;

    if (frame.type === "error") {
      const message = describeApiError(frame.code, frame.message, frame.params, deps.translate);
      if (frame.sessionId) {
        const engine = engines.get(frame.sessionId);
        if (!engine) return;
        patch(engine, { running: false, pending: false, error: message });
        return;
      }
      for (const engine of engines.values()) patch(engine, { error: message });
      return;
    }

    routeFrame(frame);
  });

  // 只有「重连」才需要重新取快照补齐缺口；首次连接与挂载/激活时的 hydration 重合
  deps.events.onStatus((isConnected) => {
    if (!isConnected) return;
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    for (const [sessionId, engine] of engines) {
      // 上次没取成功的（error 非空）也一并补上
      if (engine.hydrated || engine.store.getState().error !== null)
        void hydrate(sessionId, engine);
    }
  });

  return {
    get: (sessionId) => (sessionId ? ensure(sessionId).store : emptyStore),

    activate(sessionId) {
      if (!sessionId) return;
      const engine = ensure(sessionId);
      if (!engine.hydrated && !engine.hydrating) void hydrate(sessionId, engine);
    },

    seed(sessionId) {
      const engine = ensure(sessionId);
      engine.token += 1;
      engine.hydrated = true;
      engine.hydrating = false;
      engine.buffer = [];
    },

    refresh(sessionId) {
      void hydrate(sessionId, ensure(sessionId));
    },

    async send(sessionId, payload) {
      const engine = ensure(sessionId);
      patch(engine, { error: null });
      const optimistic = appendUserItem(
        engine.store.getState().items,
        optimisticBlocks(deps.client, payload),
      );
      // 立刻给出反馈：首个 token 都算在这段等待里
      patch(engine, { items: optimistic.items, pending: true });

      try {
        await deps.client.messages.prompt({
          sessionId,
          text: payload.text,
          ...(payload.contexts.length > 0 ? { contexts: payload.contexts } : {}),
          ...(payload.attachments.length > 0
            ? { attachments: payload.attachments.map((attachment) => ({ id: attachment.id })) }
            : {}),
        });
        return true;
      } catch (error) {
        // 没投出去就别在消息区留一条发不出去的消息（调用方会把原文还回输入框）
        patch(engine, {
          items: removeUserItem(engine.store.getState().items, optimistic.id),
          error: describeError(error, deps.translate),
          pending: false,
        });
        return false;
      }
    },

    async edit(sessionId, entryId, text) {
      const engine = ensure(sessionId);
      patch(engine, { error: null });
      try {
        await deps.client.messages.edit({ sessionId, entryId, text });
        return true;
      } catch (error) {
        patch(engine, { error: describeError(error, deps.translate) });
        return false;
      }
    },

    async interrupt(sessionId) {
      try {
        await deps.client.messages.interrupt(sessionId);
      } catch {
        // 忽略：中断失败时服务端仍会继续上报事件
      }
    },
  };
};
