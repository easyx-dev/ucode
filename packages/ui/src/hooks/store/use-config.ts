/** 已保存配置的 React 绑定：只读快照（改动走设置页的草稿流程与 `config/update`） */
import type { ConfigSnapshot } from "@ucode/contracts";
import { useClient } from "../../provider";
import { useStore } from "../use-store";

export function useConfig(): ConfigSnapshot | null {
  const client = useClient();
  return useStore(client.config).data;
}
