/** 运行时状态的 React 绑定：目前只用于取 agent 工作目录 */
import type { HealthResponse } from "@ucode/contracts";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export function useHealth(): HealthResponse | null {
  const client = useClient();
  return useStore(client.health);
}
