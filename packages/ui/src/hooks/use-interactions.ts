/**
 * 交互请求的 React 绑定：按当前会话取待答请求，答复转发到 SDK store。
 *
 * 请求的订阅、重连补齐都在 store 内完成；本 hook 负责切换会话时补一次。
 */
import type { InteractionRespondRequest, PendingInteraction } from "@ucode/contracts";
import { useCallback, useEffect } from "react";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export type InteractionsController = {
  /** 按提出顺序排列的待答请求；界面只展示第一条 */
  pending: PendingInteraction[];
  /** 回填一条答复；服务端按 kind 判别载荷 */
  respond: (input: InteractionRespondRequest) => Promise<void>;
};

export function useInteractions(sessionId: string | null): InteractionsController {
  const client = useClient();
  const state = useStore(client.interactions);

  useEffect(() => {
    if (sessionId) void client.interactions.hydrate(sessionId);
  }, [client, sessionId]);

  const respond = useCallback(
    (input: InteractionRespondRequest) => client.interactions.respond(input),
    [client],
  );

  return {
    pending: sessionId ? (state.pending[sessionId] ?? []) : [],
    respond,
  };
}
