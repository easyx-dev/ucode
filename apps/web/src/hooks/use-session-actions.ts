/** 会话动作：新建、重命名、换模型、改 thinking level、归档 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SessionListController } from "@/hooks/use-session-list";
import { api, describeError } from "@/lib/api";
import type { SessionCreateRequest, SessionSummary, ThinkingLevel } from "@/lib/types";

/** 可提交给 sessions/update 的字段，与 SessionSummary 的可选字段同名 */
type SessionPatch = {
  name?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  mode?: string;
};

export function useSessionActions(list: SessionListController) {
  const { t } = useTranslation();
  const { refresh, patch, addDraft, drop } = list;

  /** 建会话：首发消息时把草稿提升成真会话（见 useChat）；`seed` 是它的初始设置 */
  const create = useCallback(
    async (seed: SessionCreateRequest = {}): Promise<SessionSummary | null> => {
      try {
        const session = await api.sessions.create(seed);
        addDraft(session);
        return session;
      } catch (error) {
        toast.error(t("失败提示", { label: t("新建会话失败"), reason: describeError(error) }));
        return null;
      }
    },
    [addDraft, t],
  );

  const applyUpdate = useCallback(
    async (sessionId: string, next: SessionPatch, failureLabel: string): Promise<void> => {
      patch(sessionId, next);
      try {
        await api.sessions.update({ sessionId, ...next });
      } catch (error) {
        toast.error(t("失败提示", { label: failureLabel, reason: describeError(error) }));
        void refresh();
      }
    },
    [patch, refresh, t],
  );

  const rename = useCallback(
    (sessionId: string, name: string) => applyUpdate(sessionId, { name }, t("重命名失败")),
    [applyUpdate, t],
  );

  const setModel = useCallback(
    (sessionId: string, model: string) => applyUpdate(sessionId, { model }, t("切换模型失败")),
    [applyUpdate, t],
  );

  const setThinkingLevel = useCallback(
    (sessionId: string, thinkingLevel: ThinkingLevel) =>
      applyUpdate(sessionId, { thinkingLevel }, t("设置thinking失败")),
    [applyUpdate, t],
  );

  const setMode = useCallback(
    (sessionId: string, mode: string) => applyUpdate(sessionId, { mode }, t("切换模式失败")),
    [applyUpdate, t],
  );

  const archive = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await api.sessions.archive(sessionId);
        drop(sessionId);
        toast.success(t("已归档"));
      } catch (error) {
        toast.error(t("失败提示", { label: t("归档失败"), reason: describeError(error) }));
      }
    },
    [drop, t],
  );

  /** 会话分叉：从某条消息抽出新会话；导航由调用方处理 */
  const fork = useCallback(
    async (sessionId: string, fromEntryId?: string): Promise<SessionSummary | null> => {
      try {
        const session = await api.sessions.fork({
          sessionId,
          ...(fromEntryId ? { fromEntryId } : {}),
        });
        addDraft(session);
        return session;
      } catch (error) {
        toast.error(t("失败提示", { label: t("分叉失败"), reason: describeError(error) }));
        return null;
      }
    },
    [addDraft, t],
  );

  return { create, rename, setModel, setThinkingLevel, setMode, archive, fork };
}
