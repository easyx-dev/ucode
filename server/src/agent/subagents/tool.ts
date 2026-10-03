/**
 * subagent 工具：父会话把一段任务委派给独立子会话，拿回它的最终结论。
 *
 * 工具本身不做能力决策：角色解析与能力交集在 `agent/agents`，生命周期在 `spawn`。
 * 可用角色由调用方按注册表传入（内置 + 自定义），工具描述据此动态生成；
 * 子会话看不到当前对话，所以 task 必须自包含——这点写在工具描述与提示词里。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { THINKING_LEVELS } from "@ucode/contracts";
import { Type } from "typebox";

import { type AgentProfile, SUBAGENT_PROFILES } from "../agents";
import type { SubagentHooks } from "./types";

const formatResult = (sessionId: string, text: string): string =>
  [
    `task_id: ${sessionId}（需要时可带 task_id 续跑）`,
    "",
    "<task_result>",
    text.trim() || "（子智能体没有产出文本）",
    "</task_result>",
  ].join("\n");

/** 角色清单：缺省回落内置角色，保证注册表为空时工具仍可用且能识别 general / explore */
const resolveProfiles = (profiles: readonly AgentProfile[]): AgentProfile[] =>
  profiles.length > 0 ? [...profiles] : Object.values(SUBAGENT_PROFILES);

/** 只把需要广告的角色写进描述；全部隐藏时不留一个空的「可选角色」标题 */
const buildDescription = (profiles: readonly AgentProfile[]): string => {
  const base =
    "把一个独立任务委派给子智能体，它会在同一个工作目录里自己完成并只把最终结论带回来。" +
    "子智能体看不到当前对话，task 必须自包含；它会消耗额外的模型调用。";
  const advertised = profiles.filter((profile) => profile.advertise !== false);
  if (advertised.length === 0) return base;
  const roles = advertised.map((profile) => `- ${profile.slug}：${profile.description}`).join("\n");
  return `${base}\n可选角色：\n${roles}`;
};

export const createSubagentTool = (
  hooks: SubagentHooks,
  availableProfiles: readonly AgentProfile[],
) => {
  const profiles = resolveProfiles(availableProfiles);
  // 入参枚举包含全部角色（含隐藏角色），描述只列需要广告的
  const agentSchema =
    profiles.length === 1
      ? Type.Literal(profiles[0]?.slug ?? "")
      : Type.Union(
          profiles.map((profile) => Type.Literal(profile.slug)),
          { description: "子智能体角色；缺省 general" },
        );

  return defineTool({
    name: "subagent",
    label: "subagent",
    description: buildDescription(profiles),
    promptSnippet: "把独立任务委派给子智能体",
    promptGuidelines: [
      "任务目标明确、可以独立完成时才委派；需要连续对话或用户拍板的不要委派。",
      "task 必须自包含：把背景、目标、约束、期望产出写全，子智能体看不到当前对话。",
      "需要只读调研 / 评审用 explore，需要它动手就用 general。",
      "需要让之前的子智能体接着做时，带上它返回的 task_id 续跑，而不是重新新建。",
      "子会话会消耗额外模型调用，不要为琐碎问题分派。",
    ],
    parameters: Type.Object({
      agent: Type.Optional(agentSchema),
      description: Type.Optional(
        Type.String({ description: "任务简称，3–5 个词，用于会话名与展示；续跑时可省" }),
      ),
      task: Type.String({ description: "交给子智能体的完整任务，必须自包含" }),
      task_id: Type.Optional(
        Type.String({ description: "已有子会话 id；带上则在该子会话上续跑，不新建" }),
      ),
      model: Type.Optional(
        Type.String({
          description: "新建子会话时覆盖模型 provider/model；续跑（带 task_id）不支持覆盖",
        }),
      ),
      thinkingLevel: Type.Optional(
        Type.Union(
          THINKING_LEVELS.map((level) => Type.Literal(level)),
          {
            description: "新建子会话时覆盖思考档位；续跑（带 task_id）不支持覆盖",
          },
        ),
      ),
    }),
    async execute(
      toolCallId,
      { agent, description, task, task_id: taskId, model, thinkingLevel },
      signal,
    ) {
      const result = await hooks.spawn(
        toolCallId,
        {
          ...(agent ? { agent } : {}),
          ...(description ? { description } : {}),
          task,
          ...(taskId ? { taskId } : {}),
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
};
