/**
 * 登录状态：whoami 探知、登录 / 登出、改密码与活动会话。
 *
 * 传输层收到 401 时通过 `markAnonymous` 把状态切回未登录，UI 据此跳登录页。
 * 密码类动作只在这里收口错误（`error`），列表 / 配对等由调用方自行处理异常。
 */
import type {
  AuthLoginRequest,
  AuthPasswordRequest,
  AuthSessionView,
  PairingCreateOutput,
} from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import { createStore, type Store } from "../store";

export type AuthState = {
  /** unknown 表示尚未探知；首屏据此避免「先闪应用再跳登录」 */
  status: "unknown" | "authenticated" | "anonymous";
  session: AuthSessionView | null;
  /** 最近一次失败：密码类动作，或首屏探知失败（网络不通 / 服务未启动） */
  error: ApiError | null;
  /** 密码类动作进行中 */
  busy: boolean;
};

export type AuthStore = {
  getState: Store<AuthState>["getState"];
  subscribe: Store<AuthState>["subscribe"];
  /** 探知当前登录态（首屏） */
  load: () => Promise<void>;
  /** 密码登录；返回是否成功 */
  login: (input: AuthLoginRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  /** 改密码；成功后全部会话失效，本端也回到未登录 */
  changePassword: (input: AuthPasswordRequest) => Promise<boolean>;
  /** 传输层 401 回调 */
  markAnonymous: () => void;
  listSessions: () => Promise<AuthSessionView[]>;
  revokeSession: (id: string) => Promise<boolean>;
  createPairing: () => Promise<PairingCreateOutput>;
};

export const createAuthStore = (deps: { apis: Apis }): AuthStore => {
  const store = createStore<AuthState>({
    status: "unknown",
    session: null,
    error: null,
    busy: false,
  });

  const anonymous = (error: ApiError | null): AuthState => ({
    status: "anonymous",
    session: null,
    error,
    busy: false,
  });

  const load = async (): Promise<void> => {
    try {
      const whoami = await deps.apis.auth.session();
      store.setState({
        status: "authenticated",
        session: whoami.session,
        error: null,
        busy: false,
      });
    } catch (error) {
      const failure = asApiError(error);
      // 只有 401 才是「登录态无效」；网络不通 / 服务未启动不能把用户甩到登录页
      if (failure.httpStatus !== 401) {
        store.setState((prev) => ({ ...prev, error: failure, busy: false }));
        return;
      }
      store.setState(anonymous(null));
    }
  };

  const login = async (input: AuthLoginRequest): Promise<boolean> => {
    store.setState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      const { session } = await deps.apis.auth.login(input);
      store.setState({ status: "authenticated", session, error: null, busy: false });
      return true;
    } catch (error) {
      store.setState(anonymous(asApiError(error)));
      return false;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await deps.apis.auth.logout();
    } catch {
      // 会话已失效也继续清本地态
    }
    store.setState(anonymous(null));
  };

  const changePassword = async (input: AuthPasswordRequest): Promise<boolean> => {
    store.setState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      await deps.apis.auth.changePassword(input);
      // 改密码撤销全部会话，包括本端
      store.setState(anonymous(null));
      return true;
    } catch (error) {
      store.setState((prev) => ({ ...prev, busy: false, error: asApiError(error) }));
      return false;
    }
  };

  const markAnonymous = (): void => {
    store.setState((prev) => (prev.status === "anonymous" ? prev : anonymous(null)));
  };

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    login,
    logout,
    changePassword,
    markAnonymous,
    async listSessions() {
      return (await deps.apis.auth.sessions()).sessions;
    },
    async revokeSession(id: string) {
      return (await deps.apis.auth.revokeSession(id)).revoked;
    },
    createPairing: () => deps.apis.auth.createPairing(),
  };
};
