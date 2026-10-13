/**
 * 目标与计划：`/goal` 命令的落地（草稿态先建会话再设目标）、目标预算、计划批准与忽略。
 */
import type { SessionCreateRequest } from "@ucode/contracts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { lastTurnPresentedPlan } from "../../business/chat/message/plan";
import type { GoalCommand } from "../../business/goal/goal-command";
import type { useChat } from "../../hooks/store/use-chat";
import type { useGoal } from "../../hooks/store/use-goal";
import type { useSessions } from "../../hooks/store/use-sessions";
import type { useActiveSession } from "../../hooks/use-active-session";

export type GoalAndPlan = {
  /** plan 模式本轮以 present_plan 收尾：用决策表单替掉输入区 */
  planReady: boolean;
  approvePlan: () => void;
  ignorePlan: () => void;
  runGoalCommand: (command: GoalCommand, seed?: SessionCreateRequest) => void;
  /** 预算可以清空（null 表示不限） */
  setGoalBudget: (tokenBudget: number | null) => void;
};

export function useGoalAndPlan({
  activeId,
  session,
  chat,
  goal,
  sessions,
  setActiveId,
}: {
  activeId: string | null;
  session: ReturnType<typeof useActiveSession>;
  chat: ReturnType<typeof useChat>;
  goal: ReturnType<typeof useGoal>;
  sessions: ReturnType<typeof useSessions>;
  setActiveId: (sessionId: string | null) => void;
}): GoalAndPlan {
  const { t } = useTranslation();

  // plan 模式本轮以 present_plan 收尾：用决策表单替掉输入区
  const planReady =
    session?.mode === "plan" && !chat.streaming && lastTurnPresentedPlan(chat.items);

  /** 批准计划：先切回编码模式（模式的校验与生效在服务端），再让服务端注入开工指令 */
  const approvePlan = (): void => {
    if (!activeId) return;
    void (async () => {
      await sessions.setMode(activeId, "build");
      await chat.approvePlan();
    })();
  };

  // 忽略本次计划：服务端往会话文件追加标记条目，表单靠 transcript_reset 收起
  const ignorePlan = (): void => {
    void chat.ignorePlan();
  };

  /** `/goal` 命令：草稿态先建会话再设目标；其余命令作用于当前会话 */
  const runGoalCommand = (command: GoalCommand, seed: SessionCreateRequest = {}): void => {
    void (async () => {
      if (command.kind === "set") {
        if (activeId) {
          await goal.set(activeId, { objective: command.objective });
          return;
        }
        const created = await sessions.create(seed);
        if (!created) return;
        await goal.set(created.id, { objective: command.objective });
        setActiveId(created.id);
        return;
      }
      if (!activeId) {
        toast.info(t("还没有设置目标"));
        return;
      }
      switch (command.kind) {
        case "pause":
          await goal.pause(activeId);
          break;
        case "resume":
          await goal.resume(activeId);
          break;
        case "clear":
          await goal.clear(activeId);
          break;
        case "status":
          if (goal.goal) await goal.refresh(activeId);
          else toast.info(t("还没有设置目标"));
          break;
      }
    })();
  };

  const setGoalBudget = (tokenBudget: number | null): void => {
    if (activeId) void goal.setBudget(activeId, tokenBudget);
  };

  return { planReady, approvePlan, ignorePlan, runGoalCommand, setGoalBudget };
}
