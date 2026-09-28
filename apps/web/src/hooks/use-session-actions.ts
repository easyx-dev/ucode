/** 会话动作：新建、重命名、换模型、改 thinking level、删除 */
import { useCallback } from "react";
import { toast } from "sonner";
import type { SessionListController } from "@/hooks/use-session-list";
import { api, describeError } from "@/lib/api";
import type { SessionSummary, ThinkingLevel } from "@/lib/types";

/** 可提交给 sessions/update 的字段，与 SessionSummary 的可选字段同名 */
type SessionPatch = { name?: string; model?: string; thinkingLevel?: ThinkingLevel };

export function useSessionActions(list: SessionListController) {
  const { refresh, patch, addDraft, drop } = list;

  const create = useCallback(async (): Promise<SessionSummary | null> => {
    try {
      const session = await api.sessions.create({});
      addDraft(session);
      return session;
    } catch (error) {
      toast.error(`新建会话失败：${describeError(error)}`);
      return null;
    }
  }, [addDraft]);

  const applyUpdate = useCallback(
    async (sessionId: string, next: SessionPatch, failureLabel: string): Promise<void> => {
      patch(sessionId, next);
      try {
        await api.sessions.update({ sessionId, ...next });
      } catch (error) {
        toast.error(`${failureLabel}：${describeError(error)}`);
        void refresh();
      }
    },
    [patch, refresh],
  );

  const rename = useCallback(
    (sessionId: string, name: string) => applyUpdate(sessionId, { name }, "重命名失败"),
    [applyUpdate],
  );

  const setModel = useCallback(
    (sessionId: string, model: string) => applyUpdate(sessionId, { model }, "切换模型失败"),
    [applyUpdate],
  );

  const setThinkingLevel = useCallback(
    (sessionId: string, thinkingLevel: ThinkingLevel) =>
      applyUpdate(sessionId, { thinkingLevel }, "设置 thinking level 失败"),
    [applyUpdate],
  );

  const remove = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await api.sessions.remove(sessionId);
        drop(sessionId);
        toast.success("会话已删除");
      } catch (error) {
        toast.error(`删除失败：${describeError(error)}`);
      }
    },
    [drop],
  );

  return { create, rename, setModel, setThinkingLevel, remove };
}
