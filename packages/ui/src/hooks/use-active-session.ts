/**
 * 把受控的会话 id 解析成摘要：主列表里有就直接取，子会话（不在主列表）经 `sessions/info` 补齐。
 *
 * 导航状态（选中项、URL 同步）由应用层持有，本 hook 只做派生，不写 URL、不自行纠偏；
 * 会话已归档或 id 失效时回调 `onUnavailable`，由应用层把选中项清掉。
 */
import { ERROR_CODES, type SessionSummary } from "@ucode/contracts";
import { isApiError } from "@ucode/sdk";
import { useEffect, useRef, useState } from "react";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export function useActiveSession(
  sessionId: string | null,
  onUnavailable?: () => void,
): SessionSummary | null {
  const client = useClient();
  const state = useStore(client.sessions);
  /** 不在主列表里的当前会话（子会话）；与 sessionId 对齐后才采用 */
  const [resolved, setResolved] = useState<SessionSummary | null>(null);
  // 用 ref 持有回调：调用方常传内联函数，避免其身份变化反复触发补取
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  const listed = sessionId ? (state.list.find((item) => item.id === sessionId) ?? null) : null;
  const inList = Boolean(listed);

  useEffect(() => {
    if (!sessionId || inList) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    void client.apis.sessions
      .info(sessionId)
      .then(({ session }) => {
        if (cancelled) return;
        // 已归档（软删）的会话不再展示，交由应用层清空选中
        if (session.deletedAt) {
          onUnavailableRef.current?.();
          return;
        }
        setResolved(session);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 确认不可用（不存在 / id 非法）才清空；网络等临时故障保留选中项
        if (
          isApiError(error) &&
          (error.code === ERROR_CODES.notFound || error.code === ERROR_CODES.invalidRequest)
        ) {
          onUnavailableRef.current?.();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, inList, sessionId]);

  return listed ?? (resolved?.id === sessionId ? resolved : null);
}
