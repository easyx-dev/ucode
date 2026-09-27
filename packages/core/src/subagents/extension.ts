import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AutonomyLevel } from "@ucode/protocol";
import { Type } from "typebox";
import { findProfile, loadSubagentProfiles } from "./discovery.ts";
import type { SubagentProfile } from "./profile.ts";
import { runSubagent } from "./runner.ts";

/**
 * 子智能体工具（F-2.3）：把"派一个子智能体去做事"变成 agent 可调用的能力。
 *
 * - `action: "list"`：列出可用定义（内置 + 用户）；
 * - `action: "run"`：`name` 指定定义（省略用 `general-purpose`），`task` 是任务；
 *   `background: true`（或用定义里的 `background`）则后台跑，完成时发一条通知。
 *
 * 前台：等它跑完，把结论作为工具结果回给主对话（主对话据此继续）。
 * 后台：立即返回，不阻塞主对话；完成结果通过 `ui.notify` 送达控制层。
 */

export type SubagentsExtensionOptions = {
  dataDir: string;
  cwd: string;
  modelRuntime: ModelRuntime;
  autonomy: () => AutonomyLevel;
  sessionAllowed: Set<string>;
};

type SubagentToolDetails = {
  action: "list" | "run";
  name?: string;
  background?: boolean;
  status?: string;
  turns?: number;
};

export function createSubagentsExtension(
  options: SubagentsExtensionOptions,
): (pi: ExtensionAPI) => Promise<void> {
  let profiles: SubagentProfile[] = [];
  const running = new Map<string, { name: string; startedAt: number }>();

  const tool = defineTool({
    name: "subagent",
    label: "Subagent",
    description:
      "派一个子智能体去独立完成任务（独立上下文，跑完把结论回给你）。action=list 看可用定义；action=run 用 name+task 启动。" +
      "background=true 时立即返回、完成后再通知你。适合「需要读很多文件、多步研究」的子任务，避免主上下文被细节淹没。",
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([Type.Literal("list"), Type.Literal("run")], { description: "默认 run" }),
      ),
      name: Type.Optional(Type.String({ description: "子智能体定义名（默认 general-purpose）" })),
      task: Type.Optional(Type.String({ description: "交给子智能体的任务描述" })),
      background: Type.Optional(Type.Boolean({ description: "是否后台运行（覆盖定义里的默认）" })),
    }),

    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      ctx,
    ): Promise<AgentToolResult<SubagentToolDetails>> {
      const action = params.action ?? "run";

      if (action === "list") {
        const lines = profiles.map((profile) => {
          const tools = profile.tools === undefined ? "" : ` [tools: ${profile.tools.join(", ")}]`;
          const bg = profile.background === true ? " (默认后台)" : "";
          return `- ${profile.name}${bg}${tools} — ${profile.description}`;
        });
        const runningLines = [...running.values()].map((task) => `- (运行中) ${task.name}`);
        const text = [...lines, ...runningLines].join("\n");
        return {
          content: [{ type: "text", text: text === "" ? "（没有可用的子智能体定义。）" : text }],
          details: { action: "list" },
        };
      }

      if (params.task === undefined || params.task.trim() === "") {
        throw new Error("run 需要 task 参数。");
      }
      const name = params.name ?? "general-purpose";
      const profile = findProfile(profiles, name);
      if (profile === undefined) {
        throw new Error(
          `没有名为 ${name} 的子智能体定义（可用：${profiles.map((p) => p.name).join(", ")}）。`,
        );
      }

      const background = params.background ?? profile.background ?? false;
      const runOptions = {
        profile,
        task: params.task,
        cwd: options.cwd,
        dataDir: options.dataDir,
        modelRuntime: options.modelRuntime,
        autonomy: options.autonomy,
        sessionAllowed: options.sessionAllowed,
      };

      if (!background) {
        const result = await runSubagent(runOptions);
        if (result.status === "failed") {
          throw new Error(`子智能体 ${result.name} 失败：${result.error ?? "未知原因"}`);
        }
        return {
          content: [
            {
              type: "text",
              text: `子智能体 ${result.name} 的结论：\n\n${result.text || "(没有输出)"}`,
            },
          ],
          details: {
            action: "run",
            name: result.name,
            background: false,
            status: result.status,
            turns: result.turns,
          },
        };
      }

      // 后台：立即返回，完成时通知控制层。
      running.set(`${profile.name}-${Date.now()}`, { name: profile.name, startedAt: Date.now() });
      void runSubagent(runOptions).then(
        (result) => {
          running.clear();
          notify(
            ctx,
            result.status === "completed"
              ? `子智能体 ${result.name} 完成：${truncate(result.text)}`
              : `子智能体 ${result.name} 失败：${result.error ?? "未知原因"}`,
            result.status === "completed" ? "info" : "warning",
          );
        },
        (error: unknown) => {
          running.clear();
          notify(ctx, `子智能体 ${profile.name} 异常：${String(error)}`, "warning");
        },
      );
      return {
        content: [
          {
            type: "text",
            text: `已在后台启动子智能体 ${profile.name}；完成后会通知。可以先做别的。`,
          },
        ],
        details: { action: "run", name: profile.name, background: true, status: "started" },
      };
    },
  });

  return async (pi: ExtensionAPI): Promise<void> => {
    const loaded = await loadSubagentProfiles(options.dataDir);
    profiles = loaded.profiles;
    pi.registerTool(tool);
  };
}

function truncate(text: string): string {
  const single = text.replace(/\s+/gu, " ").trim();
  return single.length > 200 ? `${single.slice(0, 200)}…` : single;
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning"): void {
  ctx.ui?.notify(message, level);
}
