import type {
  AgentBeforeSettleEvent,
  AgentToolResult,
  BoundaryResult,
  ExtensionAPI,
  ExtensionContext,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AutonomyLevel } from "@ucode/protocol";
import { Type } from "typebox";
import {
  buildGoalPrompt,
  createGoalState,
  GOAL_CUSTOM_TYPE,
  type GoalState,
  restoreGoal,
} from "./state.ts";
import { verifyGoalCompletion } from "./verify.ts";

/**
 * 目标模式（F-1.6）：持久目标 + 每轮校验 + 自动续跑 + 用量上限。
 *
 * 自动续跑挂在基座的 `agent_before_settle` 边界上——那是"还能再要求一轮"的最后时机；
 * 每轮在续跑之前先用独立判定者校验目标是否达成（见 verify.ts），达成即停、不达成才续。
 *
 * **与计划模式互斥**：计划模式（自主级别 `plan`）下不自动续跑，且不允许设置目标——
 * 计划模式的语义是"先只读地规划、不擅自行动"，自动续跑与它直接冲突。
 */

export type GoalExtensionOptions = {
  dataDir: string;
  cwd: string;
  modelRuntime: ModelRuntime;
  /** 当前自主级别（可变）。计划模式下目标模式被禁用。 */
  autonomy: () => AutonomyLevel;
};

type GoalToolDetails = {
  action: string;
  status?: string;
  continuations?: number;
};

export function createGoalExtension(options: GoalExtensionOptions): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    let goal: GoalState | null = null;

    const persist = (next: GoalState | null): void => {
      pi.appendEntry(GOAL_CUSTOM_TYPE, next);
    };

    const tool = defineTool({
      name: "goal",
      label: "Goal",
      description:
        "管理本会话的持久目标（目标模式）。action=set 设目标（objective）、status 看状态、pause/resume 暂停或继续、complete 申报完成、clear 清除。" +
        "设了目标后系统会在每轮结束时校验是否达成，未达成则自动续跑（受额度上限约束）。",
      parameters: Type.Object({
        action: Type.Union(
          [
            Type.Literal("set"),
            Type.Literal("status"),
            Type.Literal("pause"),
            Type.Literal("resume"),
            Type.Literal("complete"),
            Type.Literal("clear"),
          ],
          { description: "要做的操作" },
        ),
        objective: Type.Optional(Type.String({ description: "set 时的目标描述" })),
        maxContinuations: Type.Optional(
          Type.Number({ description: "set 时的自动续跑额度上限（默认 8）" }),
        ),
      }),

      async execute(_toolCallId, params): Promise<AgentToolResult<GoalToolDetails>> {
        const ok = (text: string, details: GoalToolDetails): AgentToolResult<GoalToolDetails> => ({
          content: [{ type: "text", text }],
          details,
        });
        const now = new Date();

        switch (params.action) {
          case "set": {
            if (options.autonomy() === "plan") {
              throw new Error("计划模式下不能设置目标（两者互斥）：请先退出计划模式。");
            }
            if (params.objective === undefined || params.objective.trim() === "") {
              throw new Error("set 需要 objective 参数。");
            }
            goal = createGoalState(
              params.objective.trim(),
              now,
              params.maxContinuations ?? undefined,
            );
            persist(goal);
            return ok(
              `已设定目标：${goal.objective}（自动续跑额度 ${goal.maxContinuations} 轮）。`,
              {
                action: "set",
                status: goal.status,
                continuations: 0,
              },
            );
          }
          case "status": {
            if (goal === null) return ok("当前没有目标。", { action: "status" });
            return ok(renderGoal(goal), {
              action: "status",
              status: goal.status,
              continuations: goal.continuations,
            });
          }
          case "clear": {
            if (goal === null) return ok("当前没有目标。", { action: "clear" });
            goal = null;
            persist(null);
            return ok("已清除目标。", { action: "clear" });
          }
          default: {
            if (goal === null) return ok("当前没有目标。", { action: params.action });
            const status: GoalState["status"] =
              params.action === "pause"
                ? "paused"
                : params.action === "resume"
                  ? "active"
                  : "completed";
            goal = { ...goal, status, updatedAt: now.toISOString() };
            persist(goal);
            return ok(renderGoal(goal), {
              action: params.action,
              status,
              continuations: goal.continuations,
            });
          }
        }
      },
    });

    pi.registerTool(tool);

    pi.on("session_start", (_event, ctx) => {
      goal = restoreGoal(ctx.sessionManager.getEntries() as never);
    });

    pi.on("before_agent_start", (event) => {
      if (goal === null || goal.status !== "active") return;
      event.systemPromptOptions.sections.goal = buildGoalPrompt(goal);
    });

    pi.on("agent_before_settle", async (event, ctx): Promise<BoundaryResult | undefined> => {
      const current = goal;
      if (current === null || current.status !== "active") return undefined;
      // 与计划模式互斥：计划模式下不自动续跑。
      if (options.autonomy() === "plan") return undefined;

      if (current.continuations >= current.maxContinuations) {
        goal = { ...current, status: "paused", updatedAt: new Date().toISOString() };
        persist(goal);
        notify(ctx, `目标已达自动续跑上限（${current.maxContinuations} 轮），已暂停。`, "warning");
        return undefined;
      }

      const done = await verifyGoalCompletion({
        objective: current.objective,
        latest: latestAssistantText(event),
        cwd: options.cwd,
        dataDir: options.dataDir,
        modelRuntime: options.modelRuntime,
      });
      if (done) {
        goal = { ...current, status: "completed", updatedAt: new Date().toISOString() };
        persist(goal);
        notify(ctx, `目标已达成：${current.objective}`, "info");
        return undefined;
      }

      goal = {
        ...current,
        continuations: current.continuations + 1,
        updatedAt: new Date().toISOString(),
      };
      persist(goal);
      return {
        continue: true,
        entries: [
          {
            type: "custom_message",
            customType: "goal.continue",
            display: false,
            content: `继续朝目标推进：${current.objective}\n（第 ${goal.continuations}/${current.maxContinuations} 轮自动续跑；如认为已达成，调用 goal 工具 action=complete 并说明依据。）`,
          },
        ],
      };
    });
  };
}

function renderGoal(goal: GoalState): string {
  return [
    `目标：${goal.objective}`,
    `状态：${goal.status}`,
    `自动续跑：${goal.continuations}/${goal.maxContinuations}`,
    `更新于：${goal.updatedAt}`,
  ].join("\n");
}

/** 从边界事件的上下文里取最近一条助手消息的文本（判定依据）。 */
function latestAssistantText(event: AgentBeforeSettleEvent): string {
  const messages = (event.context as { contextMessages?: unknown[] }).contextMessages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown } | undefined;
    if (message?.role !== "assistant") continue;
    const text = flatten(message.content);
    if (text !== "") return text;
  }
  return "";
}

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        typeof part === "object" &&
        part !== null &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("\n");
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning"): void {
  ctx.ui?.notify(message, level);
}
