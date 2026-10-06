/**
 * 应用配置：读取当前配置快照，提交变更与连通性测试。
 *
 * 表单草稿留在界面层；这里只维护「已保存的配置」。配置变更会触发 `config_changed` 控制帧，
 * 其它端（或本端主动 reload）也能保持同步。
 */
import type {
  AppConfigPatchRequest,
  ConfigSnapshot,
  ConfigTestRequest,
  ConfigTestResponse,
} from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type ConfigState = {
  data: ConfigSnapshot | null;
  loading: boolean;
  error: ApiError | null;
};

export type ConfigStore = {
  getState: Store<ConfigState>["getState"];
  subscribe: Store<ConfigState>["subscribe"];
  load: () => Promise<void>;
  /** 提交配置；返回是否成功（成功后调用方可关闭对话框） */
  update: (patch: AppConfigPatchRequest) => Promise<boolean>;
  /** provider 连通性测试；返回结果或 null（失败已记录到 error） */
  test: (input: ConfigTestRequest) => Promise<ConfigTestResponse | null>;
};

export const createConfigStore = (deps: { apis: Apis; events: EventStream }): ConfigStore => {
  const store = createStore<ConfigState>({ data: null, loading: false, error: null });

  const load = async (): Promise<void> => {
    store.setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await deps.apis.config.info();
      store.setState((prev) => ({ ...prev, data, error: null }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    } finally {
      store.setState((prev) => ({ ...prev, loading: false }));
    }
  };

  deps.events.onEvent((frame) => {
    // 配置重建（本端保存或其它端 / 热重载）：直接采纳随帧下发的快照
    if (frame.type === "config_changed") {
      store.setState((prev) => ({ ...prev, data: frame.config, error: null }));
    }
  });

  // 重连补快照：断流期间可能错过 config_changed
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    void load();
  });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    async update(patch) {
      try {
        const data = await deps.apis.config.update(patch);
        store.setState((prev) => ({ ...prev, data, error: null }));
        return true;
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return false;
      }
    },
    async test(input) {
      try {
        return await deps.apis.config.test(input);
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return null;
      }
    },
  };
};
