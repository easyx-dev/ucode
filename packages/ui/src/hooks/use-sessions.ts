/** 会话列表与动作的 React 绑定：状态来自 SDK sessions store，动作转发到 store */
import type { SessionCreateRequest, SessionSummary, ThinkingLevel } from "@ucode/contracts";

import { useErrorText } from "../lib/error";
import { useClient } from "../provider";
import { useStore } from "./use-store";

export type SessionsController = {
  sessions: SessionSummary[];
  loading: boolean;
  /** 当前语言渲染的错误文案 */
  error: string | null;
  /** 已加载的子会话，按父会话 id 索引 */
  childrenByParent: Record<string, SessionSummary[]>;
  childrenLoading: Record<string, boolean>;
  loadChildren: (parentId: string) => Promise<void>;
  refresh: () => Promise<void>;
  create: (seed?: SessionCreateRequest) => Promise<SessionSummary | null>;
  fork: (sessionId: string, fromEntryId?: string) => Promise<SessionSummary | null>;
  rename: (sessionId: string, name: string) => Promise<void>;
  setModel: (sessionId: string, model: string) => Promise<void>;
  setThinkingLevel: (sessionId: string, level: ThinkingLevel) => Promise<void>;
  setMode: (sessionId: string, mode: string) => Promise<void>;
  archive: (sessionId: string) => Promise<void>;
};

export function useSessions(): SessionsController {
  const client = useClient();
  const state = useStore(client.sessions);
  const error = useErrorText(state.error);

  return {
    sessions: state.list,
    loading: state.loading,
    error,
    childrenByParent: state.childrenByParent,
    childrenLoading: state.childrenLoading,
    loadChildren: client.sessions.loadChildren,
    refresh: client.sessions.refresh,
    create: client.sessions.create,
    fork: client.sessions.fork,
    rename: client.sessions.rename,
    setModel: client.sessions.setModel,
    setThinkingLevel: client.sessions.setThinkingLevel,
    setMode: client.sessions.setMode,
    archive: client.sessions.archive,
  };
}
