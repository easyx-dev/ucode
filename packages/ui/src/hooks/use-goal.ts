/** 当前会话目标：切会话取一次，订阅 goal_update 增量，并提供设定 / 暂停 / 恢复 / 清除操作 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, describeError } from "../lib/api";
import { eventStream } from "../lib/event-stream";
import type { GoalView } from "../lib/types";

export type GoalInput = {
  objective: string;
  tokenBudget?: number;
};

export type GoalController = {
  goal: GoalView | null;
  set: (sessionId: string, input: GoalInput) => Promise<void>;
  pause: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  clear: (sessionId: string) => Promise<void>;
  refresh: (sessionId: string) => Promise<void>;
};

export function useGoal(sessionId: string | null): GoalController {
  const { t } = useTranslation();
  const [goal, setGoal] = useState<GoalView | null>(null);

  // 切会话时取一次目标；失败只是展示缺失，不打扰用户
  useEffect(() => {
    if (!sessionId) {
      setGoal(null);
      return;
    }
    let cancelled = false;
    void api.sessions
      .info(sessionId)
      .then(({ goal: next }) => {
        if (!cancelled) setGoal(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 目标状态变化（设定 / 暂停 / 恢复 / 清除 / 续跑 / 完成）由事件流增量同步
  useEffect(
    () =>
      eventStream.subscribe((frame) => {
        if (frame.type !== "goal_update" || frame.sessionId !== sessionId) return;
        setGoal((frame.data as GoalView | null) ?? null);
      }),
    [sessionId],
  );

  const apply = useCallback(
    async (label: string, action: () => Promise<{ goal: GoalView | null }>): Promise<void> => {
      try {
        const { goal: next } = await action();
        setGoal(next);
      } catch (error) {
        toast.error(t("失败提示.模板", { label, reason: describeError(error) }));
      }
    },
    [t],
  );

  return {
    goal,
    set: (id, input) => apply(t("设置目标失败"), () => api.goals.set({ sessionId: id, ...input })),
    pause: (id) => apply(t("暂停目标失败"), () => api.goals.pause(id)),
    resume: (id) => apply(t("恢复目标失败"), () => api.goals.resume(id)),
    clear: (id) => apply(t("清除目标失败"), () => api.goals.clear(id)),
    refresh: (id) => apply(t("目标加载失败"), () => api.goals.status(id)),
  };
}
