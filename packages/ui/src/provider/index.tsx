/**
 * 共享 UI 的运行时注入：应用层创建好的 client 经 Provider 下发给业务组件与 hooks。
 *
 * 组件不自行创建 client，也不依赖模块级单例；连接生命周期（events.start/stop）随 Provider 挂载。
 */
import type { Client } from "@ucode/sdk";
import { createContext, type ReactNode, useContext, useEffect } from "react";

const ClientContext = createContext<Client | null>(null);

export type UiProviderProps = {
  /** 应用层用 `createClient` 初始化好的实例 */
  client: Client;
  children: ReactNode;
};

export function UiProvider({ client, children }: UiProviderProps) {
  useEffect(() => {
    client.events.start();
    return () => {
      client.events.stop();
    };
  }, [client]);

  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/** 取运行时 client；未注入即被使用说明装配顺序有问题 */
export const useClient = (): Client => {
  const client = useContext(ClientContext);
  if (!client) {
    // i18n-ignore: 开发者错误，不面向用户
    throw new Error("UI client 未初始化：请用 <UiProvider client={client}> 包裹应用");
  }
  return client;
};
