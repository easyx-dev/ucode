/**
 * 当前会话设计画布的两层 React 绑定：
 *
 * - `useDesignPath` 只要「本会话当前在改哪份」（标签标题、侧栏的当前标记用），订阅 store 但**不加载**；
 * - `useDesignCanvas` 要整页画面，挂载时取一次，之后由 `design_update` 帧驱动重取。
 *
 * 分开是为了不让「拿一个路径」把整页 drawing 拉下来：工作台控制器在每个会话上都会挂，
 * 由它触发加载等于任何会话一打开就让服务端开一份文档并按会话标题算一次默认落点。
 */
import type { DesignCanvasState } from "@ucode/sdk";
import { useEffect } from "react";

import { useClient } from "../../provider";
import { useStore } from "../use-store";

export type DesignCanvasController = {
  /** 画布状态；还没加载完时为 null */
  state: DesignCanvasState | null;
  /** 最近一次失败的说明（打开 / 落盘失败）；成功后清空 */
  error: string | null;
  /** 重新取一次（摘要 + 画面） */
  reload: () => void;
  /** 选中若干节点；空数组即清空 */
  select: (ids: readonly string[]) => void;
  /** 换一页 */
  setPage: (pageId: string) => void;
  /** 新建一页并切过去 */
  createPage: () => void;
  /** 把画布指向一份稿子（来自文件树预览） */
  openFile: (path: string) => void;
};

/** 只读指针指向的路径：不加载，也就不会因为「看一眼」而让服务端落一份稿 */
export function useDesignPath(sessionId: string | null): string | null {
  const client = useClient();
  const store = useStore(client.design);
  return sessionId === null ? null : (store.bySession[sessionId]?.path ?? null);
}

export function useDesignCanvas(sessionId: string | null): DesignCanvasController {
  const client = useClient();
  const store = useStore(client.design);
  const state = sessionId ? (store.bySession[sessionId] ?? null) : null;
  const error = sessionId === null ? undefined : store.errors[sessionId];

  useEffect(() => {
    if (sessionId) void client.design.load(sessionId);
  }, [client, sessionId]);

  return {
    state,
    error: error === undefined ? null : error.message,
    reload: () => {
      if (sessionId) void client.design.load(sessionId);
    },
    select: (ids) => {
      if (sessionId) void client.design.select(sessionId, ids);
    },
    setPage: (pageId) => {
      if (sessionId) void client.design.setPage(sessionId, pageId);
    },
    createPage: () => {
      if (sessionId) void client.design.createPage(sessionId);
    },
    openFile: (path) => {
      if (sessionId) void client.design.openFile(sessionId, path);
    },
  };
}
