/** 运行时状态：取 agent 工作目录等展示信息；配置变更事件到达时自动重取 */
import type { StatusResponse } from "@ucode/contracts";

import type { Apis } from "../apis";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type StatusStore = {
  getState: Store<StatusResponse | null>["getState"];
  subscribe: Store<StatusResponse | null>["subscribe"];
  load: () => Promise<void>;
};

export const createStatusStore = (deps: { apis: Apis; events: EventStream }): StatusStore => {
  const store = createStore<StatusResponse | null>(null);

  // 取不到时保持 null，由使用方回落到通用文案，不打断主流程
  const load = async (): Promise<void> => {
    try {
      store.setState(await deps.apis.status());
    } catch {
      // 忽略：status 不可达只影响展示
    }
  };

  deps.events.onEvent((frame) => {
    if (frame.type === "config_changed") void load();
  });

  void load();

  // 重连补快照：断流期间可能错过 config_changed
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    void load();
  });

  return { getState: store.getState, subscribe: store.subscribe, load };
};
