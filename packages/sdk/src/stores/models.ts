/** 模型目录：初次加载 + 手动重建运行时；配置变更事件到达时自动重取 */
import type { ModelsResponse } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type ModelsState = {
  data: ModelsResponse | null;
  error: ApiError | null;
};

export type ModelsStore = {
  getState: Store<ModelsState>["getState"];
  subscribe: Store<ModelsState>["subscribe"];
  /** 重新读取模型目录（失败保留上一次数据） */
  reload: () => Promise<void>;
  /** 按当前配置重建运行时，返回新的目录 */
  refresh: () => Promise<void>;
};

export const createModelsStore = (deps: { apis: Apis; events: EventStream }): ModelsStore => {
  const store = createStore<ModelsState>({ data: null, error: null });

  const run = async (action: () => Promise<ModelsResponse>): Promise<void> => {
    try {
      const data = await action();
      store.setState((prev) => ({ ...prev, data, error: null }));
    } catch (error) {
      // 失败保留上一次数据，避免配置页被清空
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  const reload = () => run(() => deps.apis.models.list());
  const refresh = () => run(() => deps.apis.models.refresh());

  deps.events.onEvent((frame) => {
    if (frame.type === "config_changed") void reload();
  });

  void reload();

  // 重连补快照：断流期间可能错过 config_changed，重连后重取目录
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    void reload();
  });

  return { getState: store.getState, subscribe: store.subscribe, reload, refresh };
};
