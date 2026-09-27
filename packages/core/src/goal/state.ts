/**
 * 目标模式的会话状态（F-1.6）。
 *
 * 状态**持久化在会话记录里**（基座的 `custom` entry，`customType: "goal"`），因此：
 * - 会话恢复时可直接从记录里读回目标（不需要额外存储）；
 * - 目标变更随会话历史一起被看见（谁在什么时候设/暂停/完成了目标，可追溯）。
 */

export type GoalStatus = "active" | "paused" | "completed";

export const GOAL_CUSTOM_TYPE = "goal";

export type GoalState = {
  objective: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  /** 已自动续跑的轮次。 */
  continuations: number;
  /** 用量上限：最多自动续跑多少轮（到顶后自动暂停，不再烧额度）。 */
  maxContinuations: number;
};

export const DEFAULT_MAX_CONTINUATIONS = 8;

export type GoalEntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
};

export function createGoalState(
  objective: string,
  now: Date,
  maxContinuations = DEFAULT_MAX_CONTINUATIONS,
): GoalState {
  const iso = now.toISOString();
  return {
    objective,
    status: "active",
    createdAt: iso,
    updatedAt: iso,
    continuations: 0,
    maxContinuations,
  };
}

/**
 * 从会话记录里恢复最近一次目标状态。
 *
 * 只看**最后一条** goal 记录：`clear` 会写一条 data 为 null 的记录，它必须作为"到此为止"的
 * 终止符，而不是被跳过、回溯到更早的目标。
 */
export function restoreGoal(entries: readonly GoalEntryLike[]): GoalState | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== GOAL_CUSTOM_TYPE) continue;
    return parseGoalState(entry.data);
  }
  return null;
}

export function parseGoalState(data: unknown): GoalState | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.objective !== "string" || raw.objective === "") return null;
  const status = raw.status;
  if (status !== "active" && status !== "paused" && status !== "completed") return null;
  return {
    objective: raw.objective,
    status,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    continuations: typeof raw.continuations === "number" ? raw.continuations : 0,
    maxContinuations:
      typeof raw.maxContinuations === "number" ? raw.maxContinuations : DEFAULT_MAX_CONTINUATIONS,
  };
}

/** 目标状态渲染成系统提示的一个 section。 */
export function buildGoalPrompt(state: GoalState): string {
  const remaining = Math.max(0, state.maxContinuations - state.continuations);
  const lines = [
    "当前会话有一个**持久目标**（目标模式）。持续朝它推进，直到完成：",
    `目标：${state.objective}`,
    `状态：${state.status}`,
    `剩余自动续跑额度：${remaining} 轮（用尽后会自动暂停，等用户继续）。`,
    "完成的判据由外部校验器判定；你认为已完成时，调用 goal 工具 action=complete 并说明依据。",
  ];
  if (state.status !== "active") {
    lines.push("（目标当前未激活：暂停中，不要自行推进。）");
  }
  return lines.join("\n");
}
