/** 登录状态的 React 绑定：组件订阅状态，动作走 `useClient().auth` */
import type { AuthState } from "@ucode/sdk";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export function useAuth(): AuthState {
  const client = useClient();
  return useStore(client.auth);
}
