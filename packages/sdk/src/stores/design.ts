/**
 * 设计画布：按 sessionId 缓存「结构摘要 + 整页 drawing + 选中集」。
 *
 * 两条数据来自两条通道，缺一不可：结构摘要（页面表 / 节点 / 选中集）由 `design/snapshot` 取一次，
 * 之后只在换页 / 重置 / 重连时再取；**画面**由 `design/render` 取，并且每次都要报「我手里是哪一版」
 * ——服务端发现没变就回 `svg: null`，画布据此跳过重绘。所以工具连续改十次，画布也只画真正变过的那几次。
 *
 * 事件只带 revision（`design_update`）：画布收到就带着自己的 revision 再取一次，取不到新东西就什么都不做。
 * drawing 不进事件流，是因为同一个会话可能在多个界面同时打开，全量塞进帧里等于给每个订阅者都发一遍。
 */
import type {
  DesignBox,
  DesignDocResponse,
  DesignNodeSummary,
  DesignPage,
  DesignRender,
  DesignSelection,
  DesignSnapshot,
} from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

/** 一个会话的画布状态：摘要 + 画面，两部分都带同一版 `revision` */
export type DesignCanvasState = {
  revision: number;
  pageId: string;
  pages: DesignPage[];
  nodes: DesignNodeSummary[];
  selection: string[];
  /** 引用锚点前缀，形如 `@design:<会话 id>`；拼完整锚点用它 */
  mentionPrefix: string;
  /** 这份稿子落在哪个文件（默认在配置目录下，被 `open` 指到别处时就是那个路径） */
  path: string;
  /** 图层树是否被截断（画布据此提示「还有节点没列出来」） */
  truncated: boolean;
  /** 文档文件读不懂时的说明（已留档） */
  warning?: string;
  /** 整页 SVG；空画布为空串。不会出现「没有这个字段」的状态：取不到新画面就留着上一份 */
  svg: string;
  boxes: Record<string, DesignBox>;
  /** 内容外接矩形；空画布为 null */
  bounds: DesignBox | null;
};

export type DesignState = {
  bySession: Record<string, DesignCanvasState | null>;
  /**
   * 画布请求的失败（读取 / 落盘），**按会话**存：多标签并行时，一个会话的失败不该显示在
   * 另一个会话的画布上（那会让人以为看的那份坏了）。成功后清空该会话的这一项。
   */
  errors: Record<string, ApiError>;
};

export type DesignStore = {
  getState: Store<DesignState>["getState"];
  subscribe: Store<DesignState>["subscribe"];
  /** 某会话的画布状态；没加载过为 null */
  get: (sessionId: string | null) => DesignCanvasState | null;
  /** 首屏 / 换页：取摘要再取画面。`pageId` 不给就取文档第一页 */
  load: (sessionId: string, pageId?: string) => Promise<void>;
  /** 按当前 revision 再取一次画面（事件驱动）；没加载过就什么都不做 */
  refresh: (sessionId: string) => Promise<void>;
  /** 写回选中集：本项目里选中集只影响「用户说『这个』时模型看到什么」，不参与 revision */
  select: (sessionId: string, ids: readonly string[]) => Promise<void>;
  /** 换一页：先告诉服务端（视图状态，不涨 revision），再按新页重取 */
  setPage: (sessionId: string, pageId: string) => Promise<void>;
  /** 新建一页并切过去；`name` 不给就按编号 */
  createPage: (sessionId: string, name?: string) => Promise<void>;
  /** 把画布指向一份稿子（相对会话工作目录或绝对路径；`.design`），不存在就新建 */
  openFile: (sessionId: string, path: string) => Promise<void>;
  /** 清空重来（画布上的「重置文档」） */
  /** 立刻落盘 */
  flush: (sessionId: string) => Promise<void>;
  /** 会话关闭 / 归档：丢掉内存里的画布状态 */
  forget: (sessionId: string) => void;
};

export const createDesignStore = (deps: { apis: Apis; events: EventStream }): DesignStore => {
  const store = createStore<DesignState>({ bySession: {}, errors: {} });

  const write = (sessionId: string, state: DesignCanvasState | null): void => {
    store.setState((prev) => {
      const { [sessionId]: _cleared, ...errors } = prev.errors;
      return {
        ...prev,
        bySession: { ...prev.bySession, [sessionId]: state },
        errors,
      };
    });
  };

  const fail = (sessionId: string, error: unknown): void => {
    store.setState((prev) => ({
      ...prev,
      errors: { ...prev.errors, [sessionId]: asApiError(error) },
    }));
  };

  /** 摘要与画面合成一份状态：画面取不到（`svg: null`）时沿用上一份 */
  const merge = (
    sessionId: string,
    snapshot: DesignSnapshot,
    render: DesignRender | null,
  ): void => {
    const previous = store.getState().bySession[sessionId] ?? null;
    // 同一会话的 load / refresh 是并发的（每个 design_update 都发一次），先发的可能后回：
    // 更旧的 revision 直接丢，否则画面与命中框会倒回上一版，且不会再有事件把它拉回来
    const incoming = render === null || render.svg === null ? snapshot.revision : render.revision;
    if (previous !== null && incoming < previous.revision) return;
    if (render === null || render.svg === null) {
      // 没变：只把摘要侧可能变过的东西（选中集、页面表、revision）并进去
      write(sessionId, {
        ...(previous ?? emptyCanvas(snapshot)),
        revision: snapshot.revision,
        pageId: snapshot.pageId,
        pages: snapshot.pages,
        nodes: snapshot.nodes,
        selection: snapshot.selection,
        mentionPrefix: snapshot.mentionPrefix,
        path: snapshot.path,
        truncated: snapshot.truncated === true,
        ...(snapshot.warning === undefined ? {} : { warning: snapshot.warning }),
      });
      return;
    }
    write(sessionId, {
      revision: render.revision,
      pageId: render.pageId,
      pages: snapshot.pages,
      nodes: snapshot.nodes,
      selection: snapshot.selection,
      mentionPrefix: snapshot.mentionPrefix,
      path: snapshot.path,
      truncated: snapshot.truncated === true,
      ...(snapshot.warning === undefined ? {} : { warning: snapshot.warning }),
      svg: render.svg,
      boxes: render.boxes,
      bounds: render.bounds,
    });
  };

  /** 每个会话最近一次 `load` 的代次：乱序返回的旧结果直接作废 */
  const loadGeneration = new Map<string, number>();

  const load = async (sessionId: string, pageId?: string): Promise<void> => {
    const generation = (loadGeneration.get(sessionId) ?? 0) + 1;
    loadGeneration.set(sessionId, generation);
    try {
      const snapshot = await deps.apis.design.snapshot({
        sessionId,
        ...(pageId === undefined ? {} : { pageId }),
      });
      const render = await deps.apis.design.render({
        sessionId,
        pageId: snapshot.pageId,
      });
      // 期间又换过稿 / 换过页：这一次的结果已经不是「当前」了，丢掉（否则 path 会回退到上一份）
      if (loadGeneration.get(sessionId) !== generation) return;
      merge(sessionId, snapshot, render);
    } catch (error: unknown) {
      fail(sessionId, error);
    }
  };

  const refresh = async (sessionId: string): Promise<void> => {
    const current = store.getState().bySession[sessionId];
    if (!current) return;
    try {
      const render = await deps.apis.design.render({
        sessionId,
        pageId: current.pageId,
        revision: current.revision,
      });
      if (render.svg === null) return;
      // 画面变了，摘要里的选中集与页面表跟着刷一次（图层树与命中框都要对得上新 revision）
      const snapshot = await deps.apis.design.snapshot({ sessionId, pageId: render.pageId });
      merge(sessionId, snapshot, render);
    } catch (error: unknown) {
      fail(sessionId, error);
    }
  };

  const applyDoc = async (
    sessionId: string,
    action: "flush" | "reset" | "setPage" | "createPage" | "open",
    extra: { pageId?: string; name?: string; path?: string } = {},
  ): Promise<DesignDocResponse | null> => {
    try {
      return await deps.apis.design.doc({
        sessionId,
        action,
        ...(extra.pageId === undefined ? {} : { pageId: extra.pageId }),
        ...(extra.name === undefined ? {} : { name: extra.name }),
        ...(extra.path === undefined ? {} : { path: extra.path }),
      });
    } catch (error: unknown) {
      fail(sessionId, error);
      return null;
    }
  };

  /** 丢掉某会话的画布缓存与错误（归档 / 主动丢弃）：一页 SVG 加命中框不小，留着没有用处 */
  const forgetSession = (sessionId: string): void => {
    store.setState((prev) => {
      if (!(sessionId in prev.bySession) && !(sessionId in prev.errors)) return prev;
      const { [sessionId]: _removed, ...bySession } = prev.bySession;
      const { [sessionId]: _droppedError, ...errors } = prev.errors;
      return { ...prev, bySession, errors };
    });
  };

  deps.events.onEvent((frame) => {
    if (frame.type === "design_update") {
      void refresh(frame.sessionId);
      return;
    }
    if (frame.type === "session_archived") forgetSession(frame.sessionId);
  });

  // 重连补一次：断流期间错过的 `design_update` 不回放，只重取已加载过的会话
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    for (const sessionId of Object.keys(store.getState().bySession)) void refresh(sessionId);
  });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    get: (sessionId) => (sessionId ? (store.getState().bySession[sessionId] ?? null) : null),
    load,
    refresh,
    select: async (sessionId, ids) => {
      // 先本地落，再发：选中是高频操作，等服务端回来再变会让点选有延迟感
      const current = store.getState().bySession[sessionId];
      if (current) write(sessionId, { ...current, selection: [...ids] });
      try {
        const result: DesignSelection = await deps.apis.design.select({ sessionId, ids: [...ids] });
        const latest = store.getState().bySession[sessionId];
        if (latest) write(sessionId, { ...latest, selection: result.selection });
      } catch (error: unknown) {
        fail(sessionId, error);
      }
    },
    setPage: async (sessionId, pageId) => {
      const result = await applyDoc(sessionId, "setPage", { pageId });
      if (result) await load(sessionId, pageId);
    },
    openFile: async (sessionId, path) => {
      const result = await applyDoc(sessionId, "open", { path });
      // 换的是文档本身：摘要与画面都得重取，页码由服务端给的第一页
      if (result) await load(sessionId, result.pageId);
    },
    createPage: async (sessionId, name) => {
      const result = await applyDoc(sessionId, "createPage", name === undefined ? {} : { name });
      // 服务端回的 pageId 是新建的那一页：建完就切过去，否则用户点了加号却还停在前一页
      if (result?.pageId !== undefined) await load(sessionId, result.pageId);
    },
    flush: async (sessionId) => {
      await applyDoc(sessionId, "flush");
    },
    forget: forgetSession,
  };
};

/** 还没画过画面时的空状态：只在「摘要拿到了、画面这次取不到」的极小窗口里用到 */
const emptyCanvas = (snapshot: DesignSnapshot): DesignCanvasState => ({
  revision: snapshot.revision,
  pageId: snapshot.pageId,
  pages: snapshot.pages,
  nodes: snapshot.nodes,
  selection: snapshot.selection,
  mentionPrefix: snapshot.mentionPrefix,
  path: snapshot.path,
  truncated: snapshot.truncated === true,
  svg: "",
  boxes: {},
  bounds: null,
});
