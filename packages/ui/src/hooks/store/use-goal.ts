/** 当前会话目标的 React 绑定：切换会话取一次，订阅 goal_update 增量 */
import type { GoalView } from "@ucode/contracts";
import type { GoalInput } from "@ucode/sdk";
import { useEffect } from "react";

import { useClient } from "../../provider";
import { useStore } from "../use-store";

export type GoalController = {
  goal: GoalView | null;
  set: (sessionId: string, input: GoalInput) => Promise<void>;
  /** 只改预算（null 表示不限） */
  setBudget: (sessionId: string, tokenBudget: number | null) => Promise<void>;
  pause: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  clear: (sessionId: string) => Promise<void>;
  refresh: (sessionId: string) => Promise<void>;
};

export function useGoal(sessionId: string | null): GoalController {
  const client = useClient();
  const state = useStore(client.goal);

  useEffect(() => {
    if (sessionId) void client.goal.hydrate(sessionId);
  }, [client, sessionId]);

  return {
    goal: sessionId ? (state.bySession[sessionId] ?? null) : null,
    set: client.goal.set,
    setBudget: client.goal.setBudget,
    pause: client.goal.pause,
    resume: client.goal.resume,
    clear: client.goal.clear,
    refresh: client.goal.status,
  };
}
