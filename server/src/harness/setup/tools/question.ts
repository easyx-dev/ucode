/**
 * question：模型在信息不足、需要用户拍板时向前端提问，用户回答后本轮继续。
 *
 * 工具本身不做决策，只把结构化问题交给交互中转挂起（见 `core/interactions`）；
 * 答复与取消都以可读结果回给模型，不会让工具调用悬空；用户不答复就一直等着。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { QuestionItem } from "@ucode/contracts";
import { Type } from "typebox";

import type { QuestionAnswerResult } from "../../../core/interactions";

/** 一次提问的内容：与交互请求里的 `questions` 同形 */
export type QuestionAsk = {
  questions: QuestionItem[];
};

/** 装配层注入的提问通道：按会话把问题发给前端并等待答复 */
export type QuestionHooks = {
  ask: (ask: QuestionAsk, signal?: AbortSignal) => Promise<QuestionAnswerResult>;
};

const optionSchema = Type.Object({
  label: Type.String({ description: "选项的展示文本，1–5 个词，简短" }),
  description: Type.String({ description: "这个选项的含义或代价，一句话说清" }),
});

const questionItemSchema = Type.Object({
  header: Type.String({ description: "极短的主题标签（不超过 30 个字符），用于定位问题" }),
  question: Type.String({ description: "要问用户的完整问题" }),
  options: Type.Array(optionSchema, {
    description: "可选项；用户始终可以自行输入答案，无需为「其他」单列一项",
  }),
  multiple: Type.Optional(Type.Boolean({ description: "是否允许多选；缺省单选" })),
});

const questionSchema = Type.Object({
  questions: Type.Array(questionItemSchema, {
    minItems: 1,
    description: "一次提出的问题，合并成一次提问展示给用户",
  }),
});

/** 把答复折成给模型看的文本；跳过的项显式标注，避免模型误以为答了空字符串 */
const formatAnswers = (questions: readonly QuestionItem[], answers: string[][]): string => {
  const lines = questions.map((item, index) => {
    const picked = (answers[index] ?? []).map((value) => value.trim()).filter(Boolean);
    return `${index + 1}. ${item.header}：${picked.length > 0 ? picked.join("；") : "（用户跳过）"}`;
  });
  return ["用户已回答：", ...lines].join("\n");
};

export const createQuestionTool = (hooks: QuestionHooks) =>
  defineTool({
    name: "question",
    label: "question",
    description:
      "在信息不足或需要用户拍板时向用户提问。用户可以选用你给的选项，也可以自行输入答案；" +
      "用户回答后你会拿到答案并继续本轮。",
    promptSnippet: "向用户提问并等待回答",
    promptGuidelines: [
      "只在确实需要用户决定、且无法从代码或资料中查证时提问；能自己查清楚的不要问。",
      "一次把要问的问全（合并成一条 question 调用）；用户始终可以自行输入答案，不要单列「其他」选项。",
      "需要多选时设 multiple: true，否则为单选；有你推荐的那一项就放第一个，并在标签末尾标注「（推荐）」。",
      "用户回答后继续任务；不要就同一个问题反复追问。",
    ],
    parameters: questionSchema,
    async execute(_toolCallId, { questions }, signal) {
      const result = await hooks.ask({ questions }, signal);
      if (result.kind === "cancelled") {
        throw new Error("提问已取消：本轮生成被中断或会话已关闭。");
      }
      return {
        content: [{ type: "text", text: formatAnswers(questions, result.answers) }],
        details: { answers: result.answers },
      };
    },
  });
