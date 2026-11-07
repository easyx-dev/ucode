/**
 * 中继设置页的状态：接入状态、隧道阶段与登录 / 登出 / 写 provider，页面只管渲染。
 *
 * 隧道运行态（连接 / 重连 / 最近错误）不在事件流里，也没有变更通知：页面打开期间按间隔轮询，
 * 另给一个手动刷新入口兜住「刚断线想立刻看结果」的场景。
 */
import type { HubProviderResponse, HubStatusResponse } from "@ucode/contracts";
import type { ApiError } from "@ucode/sdk";
import { useCallback, useEffect, useState } from "react";

import { useStore } from "../../../hooks/use-store";
import { useClient } from "../../../provider";

/** 页面打开期间的轮询间隔：中继连接态的变化不频繁，够快也够省 */
const HUB_STATUS_POLL_MS = 5_000;

/** 隧道在界面上的阶段：`ready` 展示为「已连接」，`halted` 是「被拒后停手」（重试无用） */
export type HubPhase = "connected" | "connecting" | "reconnecting" | "halted" | "offline";

/** 登录表单：地址留空即沿用部署预置值，由这里收口成契约里的可选字段 */
export type HubLoginForm = {
  /** 中继地址；空串表示不覆盖本机已有的地址 */
  url: string;
  username: string;
  password: string;
};

export type Hub = {
  /** 最近一次取到的状态；null 表示还没取到（页面据此显示加载态） */
  data: HubStatusResponse | null;
  phase: HubPhase;
  /** 失败原因（登录 / 登出 / 刷新共用）：页面就地红字展示 */
  error: ApiError | null;
  /** 登录 / 登出在途：提交按钮据此禁用 */
  busy: boolean;
  /** 手动刷新在途：只有刷新按钮看它，避免轮询连带禁用提交 */
  refreshing: boolean;
  /** 写中继 provider 在途：按钮据此禁用 */
  providerBusy: boolean;
  /** 写中继 provider 的失败原因：与状态刷新的错误分开，好让按钮旁就地提示 */
  providerError: ApiError | null;
  /** 最近一次写中继 provider 的结果：界面据此提示写入了多少个模型 */
  providerResult: HubProviderResponse | null;
  login: (form: HubLoginForm) => Promise<boolean>;
  logout: () => Promise<boolean>;
  refresh: () => Promise<void>;
  /** 把中继的模型端点写成本机的普通 provider */
  addProvider: () => Promise<HubProviderResponse | null>;
};

/**
 * 服务端的阶段直接映射到界面：`ready` 是「已连接」，`idle` 是「未连接」。
 * 不再靠「连接布尔 + 重连次数」反推——`halted` 反推不出来。
 */
const phaseOf = (data: HubStatusResponse | null): HubPhase => {
  if (!data) return "offline";
  switch (data.runtime.phase) {
    case "ready":
      return "connected";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    case "halted":
      return "halted";
    default:
      return "offline";
  }
};

export function useHub(): Hub {
  const client = useClient();
  const state = useStore(client.hub);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await client.hub.status();
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  // 挂载即取一次：状态只有这一页在看
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 未接入时隧道不会自己动，轮询没意义；接入后跟住连接 / 重连与最近错误
  const configured = state.data?.configured ?? false;
  useEffect(() => {
    if (!configured) return;
    const timer = setInterval(() => void client.hub.status(), HUB_STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [client, configured]);

  const login = useCallback(
    (form: HubLoginForm): Promise<boolean> =>
      client.hub.login({
        // 留空表示沿用本机已有的地址（含部署预置值），故传 undefined 而不是空串
        url: form.url.trim() || undefined,
        username: form.username.trim(),
        password: form.password,
      }),
    [client],
  );

  return {
    data: state.data,
    phase: phaseOf(state.data),
    error: state.error,
    busy: state.busy,
    refreshing,
    providerBusy: state.providerBusy,
    providerError: state.providerError,
    providerResult: state.providerResult,
    login,
    logout: client.hub.logout,
    refresh,
    addProvider: client.hub.addProvider,
  };
}
