/**
 * 插件界面贡献：初次加载，`plugins_changed` 与工作目录变化后重取。
 *
 * 与 `plugins` 状态分开的原因：那份是**登记表**（设置页用，带诊断与开关），这份是**渲染层的装配输入**
 * （只有启用且受信任的插件，模块地址已拼好）。两者也按不同的 cwd 参数取用，混在一起会互相冲掉。
 */
import type { PluginsUiResponse } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type PluginUiState = {
  data: PluginsUiResponse | null;
  error: ApiError | null;
};

export type PluginUiStore = {
  getState: Store<PluginUiState>["getState"];
  subscribe: Store<PluginUiState>["subscribe"];
  /** 重取贡献清单；`cwd` 决定项目级覆盖后的生效开关（插件在这个仓库里被关掉就不出界面） */
  load: (cwd?: string | null) => Promise<void>;
};

export const createPluginUiStore = (deps: { apis: Apis; events: EventStream }): PluginUiStore => {
  const store = createStore<PluginUiState>({ data: null, error: null });
  let lastCwd: string | null = null;

  const load = async (cwd?: string | null): Promise<void> => {
    if (cwd !== undefined) lastCwd = cwd;
    try {
      const data = await deps.apis.plugins.ui(lastCwd ? { cwd: lastCwd } : {});
      store.setState(() => ({ data, error: null }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  // 装 / 卸 / 启停 / 重拉都会推进代次并广播这帧：界面贡献可能整个变了，按当前 cwd 重取
  deps.events.onEvent((frame) => {
    if (frame.type !== "plugins_changed") return;
    void load();
  });

  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    void load();
  });

  void load();

  return { getState: store.getState, subscribe: store.subscribe, load };
};
