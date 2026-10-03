/**
 * subagent 工具：父会话把一段任务委派给独立子会话，拿回它的最终结论。
 *
 * 工具本身不做能力决策：角色解析与能力交集在 `agent/agents`，生命周期在 `spawn`。
 * 子会话看不到当前对话，所以 task 必须自包含——这点写在工具描述与提示词里。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { THINKING_LEVELS } from "@ucode/contracts";
import { Type } from "typebox";

import { SUBAGENT_SLUGS } from "../agents";
import type { SubagentHooks } from "./types";

const formatResult = (sessionId: string, text: string): string =>
  [
    `task_id: ${sessionId}（需要时可带 task_id 续跑）`,
    "",
    "<task_result>",
    text.trim() || "（子智能体没有产出文本）",
    "</task_result>",
  ].join("\n");

export const createSubagentTool = (hooks: SubagentHooks) =>
  defineTool({
    name: "subagent",
    label: "subagent",
    description:
      "把一个独立任务委派给子智能体，它会在同一个工作目录里自己完成并只把最终结论带回来。" +
      `角色可选：${SUBAGENT_SLUGS.join(" / ")}（general 继承当前能力，explore 只读）。` +
      "子智能体看不到当前对话，task 必须自包含；它会消耗额外的模型调用。",
    promptSnippet: "把独立任务委派给子智能体",
    promptGuidelines: [
      "任务目标明确、可以独立完成时才委派；需要连续对话或用户拍板的不要委派。",
      "task 必须自包含：把背景、目标、约束、期望产出写全，子智能体看不到当前对话。",
      "需要只读调研 / 评审用 explore，需要它动手就用 general。",
      "子会话会消耗额外模型调用，不要为琐碎问题分派。",
    ],
    parameters: Type.Object({
      agent: Type.Optional(
        Type.Union(
          SUBAGENT_SLUGS.map((slug) => Type.Literal(slug)),
          { description: "子智能体角色；缺省 general" },
        ),
      ),
      description: Type.String({ description: "任务简称，3–5 个词，用于会话名与展示" }),
      task: Type.String({ description: "交给子智能体的完整任务，必须自包含" }),
      model: Type.Optional(
        Type.String({ description: "覆盖模型 provider/model；缺省继承当前会话" }),
      ),
      thinkingLevel: Type.Optional(
        Type.Union(
          THINKING_LEVELS.map((level) => Type.Literal(level)),
          {
            description: "覆盖思考档位；缺省继承当前会话",
          },
        ),
      ),
    }),
    async execute(toolCallId, { agent, description, task, model, thinkingLevel }, signal) {
      const result = await hooks.spawn(
        toolCallId,
        {
          ...(agent ? { agent } : {}),
          description,
          task,
          ...(model ? { model } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        },
        signal,
      );
      return {
        content: [{ type: "text", text: formatResult(result.sessionId, result.text) }],
        details: { sessionId: result.sessionId },
      };
    },
  });
