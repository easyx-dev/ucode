/** MCP 服务器列表：初次加载，增删改后由 mcp_changed 控制帧刷新 */
import type { McpListResponse, McpUpsertRequest } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type McpState = {
  data: McpListResponse | null;
  error: ApiError | null;
};

export type McpStore = {
  getState: Store<McpState>["getState"];
  subscribe: Store<McpState>["subscribe"];
  load: () => Promise<void>;
  upsert: (input: McpUpsertRequest) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
};

export const createMcpStore = (deps: { apis: Apis; events: EventStream }): McpStore => {
  const store = createStore<McpState>({ data: null, error: null });

  const load = async (): Promise<void> => {
    try {
      const data = await deps.apis.mcp.list();
      store.setState((prev) => ({ ...prev, data, error: null }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  deps.events.onEvent((frame) => {
    if (frame.type === "mcp_changed") {
      store.setState((prev) => ({ ...prev, data: frame.mcp, error: null }));
    }
  });

  void load();

  // 重连补快照：断流期间可能错过 mcp_changed
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
    async upsert(input) {
      try {
        await deps.apis.mcp.upsert(input);
        return true;
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return false;
      }
    },
    async remove(name) {
      try {
        await deps.apis.mcp.remove(name);
        return true;
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return false;
      }
    },
  };
};
