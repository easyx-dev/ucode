/**
 * 交互请求（权限审批 / 提问）：按 sessionId 缓存待答列表。
 *
 * 由 `interaction_request` / `interaction_resolved` 事件驱动；刷新 / 重连后经 `interactions/list` 补齐。
 */
import type { InteractionRespondRequest, PendingInteraction } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type InteractionsState = {
  /** 按 sessionId 索引的待答请求，按提出顺序 */
  pending: Record<string, PendingInteraction[]>;
  error: ApiError | null;
};

export type InteractionsStore = {
  getState: Store<InteractionsState>["getState"];
  subscribe: Store<InteractionsState>["subscribe"];
  /** 取某会话的待答请求；sessionId 为 null 时返回空数组 */
  getPending: (sessionId: string | null) => PendingInteraction[];
  /** 从服务端补齐某会话挂起的请求 */
  hydrate: (sessionId: string) => Promise<void>;
  /** 回填一条答复；失败时重新补齐，避免对话框消失 */
  respond: (input: InteractionRespondRequest) => Promise<void>;
};

const withoutRequest = (
  pending: Record<string, PendingInteraction[]>,
  requestId: string,
): Record<string, PendingInteraction[]> => {
  const next: Record<string, PendingInteraction[]> = {};
  let changed = false;
  for (const [sessionId, list] of Object.entries(pending)) {
    const filtered = list.filter((item) => item.requestId !== requestId);
    if (filtered.length !== list.length) changed = true;
    next[sessionId] = filtered;
  }
  return changed ? next : pending;
};

export const createInteractionsStore = (deps: {
  apis: Apis;
  events: EventStream;
}): InteractionsStore => {
  const store = createStore<InteractionsState>({ pending: {}, error: null });
  /** 已补齐过的会话；重连后据此重取，避免断线期间的请求漏掉 */
  const hydrated = new Set<string>();
  let connectedOnce = false;

  const hydrate = async (sessionId: string): Promise<void> => {
    hydrated.add(sessionId);
    try {
      const data = await deps.apis.interactions.list(sessionId);
      store.setState((prev) => ({
        ...prev,
        pending: { ...prev.pending, [sessionId]: data.interactions },
        error: null,
      }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  deps.events.onEvent((frame) => {
    if (frame.type === "interaction_request") {
      const request = frame.data as PendingInteraction;
      store.setState((prev) => {
        const current = prev.pending[request.sessionId] ?? [];
        if (current.some((item) => item.requestId === request.requestId)) return prev;
        return {
          ...prev,
          pending: { ...prev.pending, [request.sessionId]: [...current, request] },
        };
      });
      return;
    }
    if (frame.type === "interaction_resolved") {
      const { requestId } = frame.data as { requestId: string };
      store.setState((prev) => {
        const pending = withoutRequest(prev.pending, requestId);
        return pending === prev.pending ? prev : { ...prev, pending };
      });
    }
  });

  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    for (const sessionId of hydrated) void hydrate(sessionId);
  });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    getPending: (sessionId) => (sessionId ? (store.getState().pending[sessionId] ?? []) : []),
    hydrate,
    async respond(input) {
      const state = store.getState();
      let sessionId: string | null = null;
      for (const [id, list] of Object.entries(state.pending)) {
        if (list.some((item) => item.requestId === input.requestId)) {
          sessionId = id;
          break;
        }
      }
      // 先本地移除，避免重复点击；失败或请求失效由 resolved 事件兜底
      store.setState((prev) => {
        const pending = withoutRequest(prev.pending, input.requestId);
        return pending === prev.pending ? prev : { ...prev, pending };
      });
      try {
        const result = await deps.apis.interactions.respond(input);
        // 服务端没结算（kind 不一致 / 请求已失效）时本地已把它抹掉：重新取一次，
        // 免得对话框凭空消失而服务端其实还挂着这条请求
        if (!result.resolved && sessionId) void hydrate(sessionId);
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        // 服务端请求可能仍挂起，重新取回以免对话框消失
        if (sessionId) void hydrate(sessionId);
      }
    },
  };
};
