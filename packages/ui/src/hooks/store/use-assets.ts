/** 资产清单的 React 绑定：状态与增删改在 SDK assets store，失败由 ErrorToaster 统一提示 */
import type {
  AssetDetail,
  AssetsDeleteRequest,
  AssetsListRequest,
  AssetsListResponse,
  AssetsReadRequest,
  AssetsSaveRequest,
} from "@ucode/contracts";
import { useEffect } from "react";
import { useClient } from "../../provider";
import { useStore } from "../use-store";

export function useAssets(target: AssetsListRequest): {
  data: AssetsListResponse | null;
  read: (input: AssetsReadRequest) => Promise<AssetDetail | null>;
  save: (input: AssetsSaveRequest) => Promise<boolean>;
  remove: (input: AssetsDeleteRequest) => Promise<boolean>;
} {
  const client = useClient();
  const state = useStore(client.assets);
  const sessionId = target.sessionId ?? null;
  const cwd = target.cwd ?? null;

  useEffect(() => {
    void client.assets.load(sessionId ? { sessionId } : cwd ? { cwd } : {});
  }, [client, sessionId, cwd]);

  /**
   * 写盘改掉了 `/` 菜单的数据源（它按上下文缓存：有会话时按 sessionId，否则按 cwd）。
   * 这里只重取当前上下文的键；会话内的清单仍以该会话装配时的那份为准——
   * 技能的广告与角色枚举本来也只对新会话生效。
   */
  const refreshCommands = (): Promise<void> =>
    client.commands.load(sessionId ? { sessionId } : cwd ? { cwd } : {});

  return {
    data: state.data,
    read: (input) => client.assets.read(input),
    save: async (input) => {
      const done = await client.assets.save(input);
      if (done) await refreshCommands();
      return done;
    },
    remove: async (input) => {
      const done = await client.assets.remove(input);
      if (done) await refreshCommands();
      return done;
    },
  };
}
