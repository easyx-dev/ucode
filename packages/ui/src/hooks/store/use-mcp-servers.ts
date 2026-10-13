/** MCP 服务器列表的 React 绑定：状态与增删改都在 SDK mcp store，失败由 ErrorToaster 统一提示 */
import type { McpListResponse, McpUpsertRequest } from "@ucode/contracts";
import { useClient } from "../../provider";
import { useStore } from "../use-store";

export function useMcpServers(): {
  data: McpListResponse | null;
  upsert: (input: McpUpsertRequest) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
} {
  const client = useClient();
  const state = useStore(client.mcp);
  return { data: state.data, upsert: client.mcp.upsert, remove: client.mcp.remove };
}
