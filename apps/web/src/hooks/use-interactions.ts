/**
 * 交互请求（当前是权限审批）：订阅事件流、按会话补齐挂起请求，并回填用户答复。
 *
 * 只在当前会话内展示——切走会话的审批会超时并按拒绝处理，这是阶段 2 的已知边界。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, describeError } from "@/lib/api";
import { eventStream } from "@/lib/event-stream";
import type { PendingInteraction, PermissionDecision } from "@/lib/types";

export type InteractionsController = {
  /** 按提出顺序排列的待答请求；界面只展示第一条 */
  pending: PendingInteraction[];
  respond: (requestId: string, decision: PermissionDecision) => Promise<void>;
};

export function useInteractions(sessionId: string | null): InteractionsController {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingInteraction[]>([]);
  // 作废在途的补齐请求：快速切会话时，上一会话的响应不能覆盖当前会话
  const tokenRef = useRef(0);

  /** 取服务端挂起的请求：刷新 / 重连 / 会话切换后用，避免漏掉或残留对话框 */
  const hydrate = useCallback(async () => {
    const token = tokenRef.current + 1;
    tokenRef.current = token;

    if (!sessionId) {
      setPending([]);
      return;
    }
    try {
      const data = await api.interactions.list(sessionId);
      if (token !== tokenRef.current) return;
      setPending(data.interactions);
    } catch (error) {
      if (token !== tokenRef.current) return;
      toast.error(t("失败提示", { label: t("需要授权"), reason: describeError(error) }));
    }
  }, [sessionId, t]);

  useEffect(() => {
    setPending([]);
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    eventStream.start();

    const offFrame = eventStream.subscribe((frame) => {
      if (frame.type === "interaction_request") {
        const request = frame.data as PendingInteraction;
        if (request.sessionId !== sessionId) return;
        setPending((prev) =>
          prev.some((item) => item.requestId === request.requestId) ? prev : [...prev, request],
        );
        return;
      }
      if (frame.type === "interaction_resolved") {
        const { requestId } = frame.data as { requestId: string };
        setPending((prev) => prev.filter((item) => item.requestId !== requestId));
      }
    });

    // 重连后可能有断线期间的请求，重新补齐
    const offStatus = eventStream.onStatus((isConnected) => {
      if (isConnected) void hydrate();
    });

    return () => {
      offFrame();
      offStatus();
    };
  }, [hydrate, sessionId]);

  const respond = useCallback(
    async (requestId: string, decision: PermissionDecision): Promise<void> => {
      // 先本地移除，避免重复点击；失败或超时由 resolved 事件兜底
      setPending((prev) => prev.filter((item) => item.requestId !== requestId));
      try {
        await api.interactions.respond({ requestId, kind: "permission", decision });
      } catch (error) {
        toast.error(describeError(error));
        // 服务端请求可能仍挂起，重新取回以免对话框消失
        void hydrate();
      }
    },
    [hydrate],
  );

  return { pending, respond };
}
