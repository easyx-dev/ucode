/** 会话列表与动作的 React 绑定：状态来自 SDK sessions store，动作转发到 store */
import type {
  PermissionMode,
  SessionCreateRequest,
  SessionSummary,
  ThinkingPreference,
} from "@ucode/contracts";
import { useClient } from "../../provider";
import { useErrorText } from "../use-error-text";
import { useStore } from "../use-store";

export type SessionsController = {
  sessions: SessionSummary[];
  loading: boolean;
  /** 当前语言渲染的错误文案 */
  error: string | null;
  refresh: () => Promise<void>;
  create: (seed?: SessionCreateRequest) => Promise<SessionSummary | null>;
  fork: (sessionId: string, fromEntryId?: string) => Promise<SessionSummary | null>;
  rename: (sessionId: string, name: string) => Promise<void>;
  setModel: (sessionId: string, model: string) => Promise<void>;
  setThinkingLevel: (sessionId: string, level: ThinkingPreference) => Promise<void>;
  setMode: (sessionId: string, mode: string) => Promise<void>;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => Promise<void>;
  /** 置顶 / 取消置顶 */
  pin: (sessionId: string, pinned: boolean) => Promise<void>;
  /** 标记已读 */
  markRead: (sessionId: string) => Promise<void>;
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
    refresh: client.sessions.refresh,
    create: client.sessions.create,
    fork: client.sessions.fork,
    rename: client.sessions.rename,
    setModel: client.sessions.setModel,
    setThinkingLevel: client.sessions.setThinkingLevel,
    setMode: client.sessions.setMode,
    setPermissionMode: client.sessions.setPermissionMode,
    pin: client.sessions.pin,
    markRead: client.sessions.markRead,
    archive: client.sessions.archive,
  };
}
