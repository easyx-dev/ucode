/** 当前会话设计画布的 React 绑定：切换会话取一次，之后由 `design_update` 帧驱动重取 */
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
