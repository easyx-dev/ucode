/** 模型目录的 React 绑定：状态与加载动作都在 SDK models store */
import type { ModelsResponse } from "@ucode/contracts";

import { useClient } from "../../provider";
import { useStore } from "../use-store";

export function useModels(): {
  data: ModelsResponse | null;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const client = useClient();
  const state = useStore(client.models);
  return { data: state.data, reload: client.models.reload, refresh: client.models.refresh };
}
