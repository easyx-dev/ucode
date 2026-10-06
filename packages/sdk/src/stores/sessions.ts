/**
 * 会话列表：根会话与已加载的子会话缓存。
 *
 * 初始取一次 `sessions/list`，之后由 `session_created` / `session_updated` / `session_archived`
 * 事件驱动，不再轮询；子会话按父级懒加载，事件到达时只更新已加载的父级。
 * `transcript_reset`（忽略计划、编辑重发）不随摘要帧下发，那里按需重取单条会话。
 */
import type {
  PermissionMode,
  SessionCreateRequest,
  SessionSummary,
  ThinkingLevel,
} from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

/** 根列表一次取够；搜索由界面在本地过滤，避免事件驱动下与服务端查询状态打架 */
const LIST_LIMIT = 200;

/** 可提交给 sessions/update 的覆盖值 */
type SessionPatch = {
  name?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  mode?: string;
  permissionMode?: PermissionMode;
};

export type SessionsState = {
  /** 根会话（parentSessionId 为空），按 updatedAt 倒序 */
  list: SessionSummary[];
  loading: boolean;
  error: ApiError | null;
  /** 已加载的子会话，按父会话 id 索引 */
  childrenByParent: Record<string, SessionSummary[]>;
  /** 正在拉取子会话的父会话 id */
  childrenLoading: Record<string, boolean>;
};

export type SessionsStore = {
  getState: Store<SessionsState>["getState"];
  subscribe: Store<SessionsState>["subscribe"];
  /** 重新取根列表（并刷新已展开的子会话） */
  refresh: () => Promise<void>;
  create: (seed?: SessionCreateRequest) => Promise<SessionSummary | null>;
  fork: (sessionId: string, fromEntryId?: string) => Promise<SessionSummary | null>;
  rename: (sessionId: string, name: string) => Promise<void>;
  setModel: (sessionId: string, model: string) => Promise<void>;
  setThinkingLevel: (sessionId: string, level: ThinkingLevel) => Promise<void>;
  setMode: (sessionId: string, mode: string) => Promise<void>;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => Promise<void>;
  /** 置顶 / 取消置顶；影响列表排序，不改变会话内容 */
  pin: (sessionId: string, pinned: boolean) => Promise<void>;
  /** 标记已读：更新 `lastReadAt`，未读点随之消失 */
  markRead: (sessionId: string) => Promise<void>;
  archive: (sessionId: string) => Promise<void>;
  /** 加载（或刷新）某个父会话的子会话；重复调用即重取 */
  loadChildren: (parentId: string) => Promise<void>;
};

/** 列表排序：置顶优先（按置顶时间倒序），其余按最近更新倒序；与仓储 `SESSION_ORDER` 口径一致 */
const sortSessions = (list: SessionSummary[]): SessionSummary[] =>
  [...list].sort((a, b) => {
    if (a.pinnedAt && b.pinnedAt) {
      return b.pinnedAt.localeCompare(a.pinnedAt) || b.updatedAt.localeCompare(a.updatedAt);
    }
    if (a.pinnedAt) return -1;
    if (b.pinnedAt) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

const patchList = (
  list: SessionSummary[],
  sessionId: string,
  next: Partial<SessionSummary>,
): SessionSummary[] => list.map((item) => (item.id === sessionId ? { ...item, ...next } : item));

export const createSessionsStore = (deps: { apis: Apis; events: EventStream }): SessionsStore => {
  const store = createStore<SessionsState>({
    list: [],
    loading: true,
    error: null,
    childrenByParent: {},
    childrenLoading: {},
  });
  /** 已展开过的父会话；根列表刷新时顺带刷新它们的子会话 */
  const loadedParents = new Set<string>();

  const setState = store.setState;

  /** 已加载的父级才吸收子会话事件，否则会展示不完整的子列表 */
  const upsertChild = (session: SessionSummary): void => {
    const parentId = session.parentSessionId;
    if (!parentId) return;
    setState((prev) => {
      const current = prev.childrenByParent[parentId];
      if (!current) return prev;
      const exists = current.some((item) => item.id === session.id);
      const next = exists
        ? current.map((item) => (item.id === session.id ? session : item))
        : [...current, session];
      return { ...prev, childrenByParent: { ...prev.childrenByParent, [parentId]: next } };
    });
  };

  const upsertRoot = (session: SessionSummary): void => {
    setState((prev) => {
      const exists = prev.list.some((item) => item.id === session.id);
      const next = exists
        ? prev.list.map((item) => (item.id === session.id ? session : item))
        : [...prev.list, session];
      return { ...prev, list: sortSessions(next) };
    });
  };

  const removeSession = (sessionId: string): void => {
    setState((prev) => {
      const list = prev.list.filter((item) => item.id !== sessionId);
      let changed = list.length !== prev.list.length;
      const childrenByParent: Record<string, SessionSummary[]> = {};
      for (const [parentId, children] of Object.entries(prev.childrenByParent)) {
        const next = children.filter((item) => item.id !== sessionId);
        if (next.length !== children.length) changed = true;
        childrenByParent[parentId] = next;
      }
      // 归档父会话会级联归档子会话，缓存的整棵列表一并丢弃
      loadedParents.delete(sessionId);
      if (sessionId in childrenByParent) {
        delete childrenByParent[sessionId];
        changed = true;
      }
      return changed ? { ...prev, list, childrenByParent } : prev;
    });
  };

  const fetchChildren = async (parentId: string): Promise<SessionSummary[]> => {
    const data = await deps.apis.sessions.list({ parentSessionId: parentId, limit: LIST_LIMIT });
    return data.sessions;
  };

  /**
   * 重取单条会话的摘要。
   *
   * 有些写点服务端不补 `session_updated`（忽略计划、编辑重发都会换活动分支，只发 `transcript_reset`），
   * 而它们会改变状态（如「等待计划确认」）——只能按需重取一次。
   */
  const refreshSummary = async (sessionId: string): Promise<void> => {
    try {
      const data = await deps.apis.sessions.info(sessionId);
      if (data.session.parentSessionId) upsertChild(data.session);
      else upsertRoot(data.session);
    } catch {
      // 会话已消失（归档 / 删除）：交给 session_archived 或下一次列表刷新收敛
    }
  };

  const refresh = async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await deps.apis.sessions.list({ limit: LIST_LIMIT });
      setState((prev) => ({ ...prev, list: sortSessions(data.sessions), error: null }));

      // 已展开的父会话随根列表一起刷新：一轮委派结束后新子会话据此出现
      // 单个父级拉取失败不影响根列表，沿用上一次的子会话缓存
      const parents = [...loadedParents];
      const refreshed = await Promise.all(
        parents.map(async (parentId) => {
          try {
            return [parentId, await fetchChildren(parentId)] as const;
          } catch {
            return null;
          }
        }),
      );
      setState((prev) => {
        const next = { ...prev.childrenByParent };
        let changed = false;
        for (const entry of refreshed) {
          if (!entry) continue;
          next[entry[0]] = entry[1];
          changed = true;
        }
        return changed ? { ...prev, childrenByParent: next } : prev;
      });
    } catch (error) {
      setState((prev) => ({ ...prev, error: asApiError(error) }));
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  const loadChildren = async (parentId: string): Promise<void> => {
    loadedParents.add(parentId);
    setState((prev) => ({
      ...prev,
      childrenLoading: { ...prev.childrenLoading, [parentId]: true },
    }));
    try {
      const list = await fetchChildren(parentId);
      setState((prev) => ({
        ...prev,
        childrenByParent: { ...prev.childrenByParent, [parentId]: list },
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: asApiError(error) }));
    } finally {
      setState((prev) => ({
        ...prev,
        childrenLoading: { ...prev.childrenLoading, [parentId]: false },
      }));
    }
  };

  /** 乐观改一条会话的覆盖值；成功后事件会用权威摘要覆盖，失败回滚靠下一次 refresh */
  const patchSession = (sessionId: string, patch: Partial<SessionSummary>): void => {
    setState((prev) => {
      const inList = prev.list.some((item) => item.id === sessionId);
      const childrenByParent = { ...prev.childrenByParent };
      let inChildren = false;
      for (const [parentId, children] of Object.entries(childrenByParent)) {
        if (children.some((item) => item.id === sessionId)) {
          childrenByParent[parentId] = patchList(children, sessionId, patch);
          inChildren = true;
        }
      }
      return {
        ...prev,
        list: inList ? patchList(prev.list, sessionId, patch) : prev.list,
        childrenByParent: inChildren ? childrenByParent : prev.childrenByParent,
      };
    });
  };

  const applyUpdate = async (sessionId: string, patch: SessionPatch): Promise<void> => {
    patchSession(sessionId, patch);
    try {
      await deps.apis.sessions.update({ sessionId, ...patch });
    } catch (error) {
      setState((prev) => ({ ...prev, error: asApiError(error) }));
      void refresh();
    }
  };

  deps.events.onEvent((frame) => {
    switch (frame.type) {
      case "session_created": {
        const session = frame.data as SessionSummary;
        if (session.parentSessionId) upsertChild(session);
        else upsertRoot(session);
        return;
      }
      case "session_updated": {
        const { session } = frame.data as { session: SessionSummary };
        if (session.parentSessionId) upsertChild(session);
        else upsertRoot(session);
        return;
      }
      case "session_archived": {
        removeSession((frame.data as { sessionId: string }).sessionId);
        return;
      }
      case "transcript_reset": {
        void refreshSummary(frame.sessionId);
        return;
      }
      default:
        return;
    }
  });

  // 重连补快照：断流期间的 session_created/updated/archived 会丢失，重连后重取列表补齐
  // 首连与创建时的 refresh 重合，跳过
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    void refresh();
  });

  void refresh();

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    refresh,
    loadChildren,
    async create(seed = {}) {
      try {
        return await deps.apis.sessions.create(seed);
      } catch (error) {
        setState((prev) => ({ ...prev, error: asApiError(error) }));
        return null;
      }
    },
    async fork(sessionId, fromEntryId) {
      try {
        return await deps.apis.sessions.fork({
          sessionId,
          ...(fromEntryId ? { fromEntryId } : {}),
        });
      } catch (error) {
        setState((prev) => ({ ...prev, error: asApiError(error) }));
        return null;
      }
    },
    rename: (sessionId, name) => applyUpdate(sessionId, { name }),
    setModel: (sessionId, model) => applyUpdate(sessionId, { model }),
    setThinkingLevel: (sessionId, thinkingLevel) => applyUpdate(sessionId, { thinkingLevel }),
    setMode: (sessionId, mode) => applyUpdate(sessionId, { mode }),
    setPermissionMode: (sessionId, permissionMode) => applyUpdate(sessionId, { permissionMode }),
    async pin(sessionId, pinned) {
      // 乐观改真实字段 `pinnedAt`（不是入参的 `pinned`）：标记与排序都读它，改错字段会等到事件才生效
      patchSession(sessionId, { pinnedAt: pinned ? new Date().toISOString() : null });
      try {
        await deps.apis.sessions.update({ sessionId, pinned });
      } catch (error) {
        setState((prev) => ({ ...prev, error: asApiError(error) }));
        void refresh();
      }
    },
    async markRead(sessionId) {
      // 乐观更新未读点，权威摘要由随后的 session_updated 事件覆盖
      patchSession(sessionId, { lastReadAt: new Date().toISOString() });
      try {
        await deps.apis.sessions.read(sessionId);
      } catch (error) {
        setState((prev) => ({ ...prev, error: asApiError(error) }));
      }
    },
    async archive(sessionId) {
      try {
        await deps.apis.sessions.archive(sessionId);
      } catch (error) {
        setState((prev) => ({ ...prev, error: asApiError(error) }));
      }
    },
  };
};
