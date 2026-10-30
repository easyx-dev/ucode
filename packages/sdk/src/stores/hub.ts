/** 中继接入：地址、登录账号、设备绑定与隧道运行态；登录 / 登出、写 provider 后就地刷新 */
import type { HubLoginInput, HubProviderResponse, HubStatusResponse } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import { createStore, type Store } from "../store";

export type HubState = {
  /** 最近一次取到的中继状态；未取到为 null（界面据此显示加载态） */
  data: HubStatusResponse | null;
  /** 最近一次失败原因：登录、登出、刷新与写 provider 共用一个格子，界面就地展示 */
  error: ApiError | null;
  /** 登录 / 登出在途：界面据此禁用提交按钮 */
  busy: boolean;
  /** 写中继 provider 在途 */
  providerBusy: boolean;
  /** 写中继 provider 的失败原因：与状态刷新的错误分开，好让按钮旁就地提示 */
  providerError: ApiError | null;
  /** 最近一次写中继 provider 的结果：界面据此提示写入了多少个模型 */
  providerResult: HubProviderResponse | null;
};

export type HubStore = {
  getState: Store<HubState>["getState"];
  subscribe: Store<HubState>["subscribe"];
  /**
   * 取一次状态：手动刷新与页面轮询共用。
   * 失败只记 `error`、不动 `busy`——轮询不该反复把提交按钮按住。
   */
  status: () => Promise<void>;
  /** 登录中继并登记本机设备；成功返回 true，失败把原因记进 `error` */
  login: (input: HubLoginInput) => Promise<boolean>;
  /** 解绑本机：清掉设备与登录凭证；成功返回 true */
  logout: () => Promise<boolean>;
  /**
   * 把中继的模型端点写成本机的普通 provider；成功返回写入结果，失败把原因记进 `providerError`。
   * 写入会触发 `config_changed`，模型与配置两个 store 随之自行刷新。
   */
  addProvider: () => Promise<HubProviderResponse | null>;
};

export const createHubStore = (deps: { apis: Apis }): HubStore => {
  const store = createStore<HubState>({
    data: null,
    error: null,
    busy: false,
    providerBusy: false,
    providerError: null,
    providerResult: null,
  });

  const status = async (): Promise<void> => {
    try {
      const data = await deps.apis.hub.status();
      store.setState((prev) => ({ ...prev, data, error: null }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  /** 登录与登出同形：成功整体换快照（错误与 busy 一并清），失败只留错误 */
  const run = async (action: () => Promise<HubStatusResponse>): Promise<boolean> => {
    store.setState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      const data = await action();
      // 只换快照字段，provider 那几个字段留着（注入供应商的结果与登录状态互不干扰）
      store.setState((prev) => ({ ...prev, data, error: null, busy: false }));
      return true;
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error), busy: false }));
      return false;
    }
  };

  // 刻意不在创建时取一次：只有设置页看这份状态，打开页面时取即可，不必每次启动都打一次中继接口
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    status,
    login: (input) => run(() => deps.apis.hub.login(input)),
    logout: () => run(() => deps.apis.hub.logout()),
    async addProvider() {
      store.setState((prev) => ({ ...prev, providerBusy: true, providerError: null }));
      try {
        const result = await deps.apis.hub.addProvider();
        store.setState((prev) => ({
          ...prev,
          providerResult: result,
          providerBusy: false,
          providerError: null,
        }));
        return result;
      } catch (error) {
        store.setState((prev) => ({
          ...prev,
          providerBusy: false,
          providerError: asApiError(error),
        }));
        return null;
      }
    },
  };
};
