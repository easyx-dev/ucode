/**
 * 资产清单（角色 / 技能 / 命令）：按上下文加载，增删改后就地重取。
 *
 * 服务端不为资产写广播控制帧——写的是用户自己的文件，也没有别的订阅方；
 * 而 `/` 菜单的清单另有按上下文缓存（见 `stores/commands`），由 UI 在写入成功后自行刷新。
 */
import type {
  AssetDetail,
  AssetsDeleteRequest,
  AssetsListRequest,
  AssetsListResponse,
  AssetsReadRequest,
  AssetsSaveRequest,
} from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import { createStore, type Store } from "../store";

export type AssetsState = {
  /** 当前数据的上下文键（`sessionId ?? cwd ?? ""`）；null 表示还没加载过 */
  key: string | null;
  data: AssetsListResponse | null;
  error: ApiError | null;
};

export type AssetsStore = {
  getState: Store<AssetsState>["getState"];
  subscribe: Store<AssetsState>["subscribe"];
  /** 加载某上下文的清单；同一上下文已加载过时直接返回（`save` / `remove` 会强制重取） */
  load: (input: AssetsListRequest) => Promise<void>;
  /** 读一条资产的详情；失败返回 null 并把错误留给 store */
  read: (input: AssetsReadRequest) => Promise<AssetDetail | null>;
  /** 新建或覆盖一条资产；成功后重取清单 */
  save: (input: AssetsSaveRequest) => Promise<boolean>;
  /** 删除一条资产；成功后重取清单 */
  remove: (input: AssetsDeleteRequest) => Promise<boolean>;
};

const keyOf = (input: AssetsListRequest): string => input.sessionId ?? input.cwd ?? "";

export const createAssetsStore = (deps: { apis: Apis }): AssetsStore => {
  const store = createStore<AssetsState>({ key: null, data: null, error: null });
  let target: AssetsListRequest | null = null;

  const load = async (input: AssetsListRequest, force = false): Promise<void> => {
    target = input;
    const key = keyOf(input);
    const current = store.getState();
    if (!force && current.key === key && current.data) return;
    try {
      const data = await deps.apis.assets.list(input);
      store.setState((prev) => ({ ...prev, key, data, error: null }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, key, data: null, error: asApiError(error) }));
    }
  };

  const reload = async (): Promise<void> => {
    if (target) await load(target, true);
  };

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load: (input) => load(input),
    async read(input) {
      try {
        return await deps.apis.assets.read(input);
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return null;
      }
    },
    async save(input) {
      try {
        await deps.apis.assets.save(input);
        await reload();
        return true;
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return false;
      }
    },
    async remove(input) {
      try {
        await deps.apis.assets.remove(input);
        await reload();
        return true;
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return false;
      }
    },
  };
};
