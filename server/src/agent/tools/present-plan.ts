/**
 * present_plan：plan 模式的收尾工具。
 *
 * 它本身不产出内容——计划正文就是模型本轮的回复。工具存在的意义是给出
 * 「本轮产出的是计划、可以决策了」的确定性信号，前端据此弹出批准 / 反馈表单。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const presentPlanSchema = Type.Object({});

export const createPresentPlanTool = () =>
  defineTool({
    name: "present_plan",
    label: "present_plan",
    description:
      "方案已具体到可落地步骤时，把本轮计划提交给用户决策，是回复的最后一步。计划正文写在回复里；" +
      "调用它之后本轮立即结束——不得再调用任何工具，也不得再输出任何内容（含补充提问）。" +
      "若还需要用户拍板方向（多候选、需求不明、是否动手），不要调用它：先用 question 提问，本轮不提交计划。",
    promptSnippet: "提交计划并结束本轮，等待用户批准或反馈",
    promptGuidelines: [
      "方案已具体到可落地步骤时才调用：计划正文写在回复中，回复的末尾调用 present_plan 收尾。",
      "还需要用户拍板方向（多候选、需求不明、是否动手）时不要调用它，先用 question 提问，本轮不提交计划。",
      "present_plan 一旦调用，本轮即结束：用户会批准（切到编码模式执行）或给出反馈继续讨论，需要确认的点写进计划即可。",
    ],
    parameters: presentPlanSchema,
    async execute() {
      return {
        content: [
          {
            type: "text",
            text: "本轮到此结束。不要继续输出任何内容，也不要再调用工具；等待用户批准或反馈。",
          },
        ],
        details: {},
      };
    },
  });
