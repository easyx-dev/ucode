import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * `question` —— 把"问用户"做成工具。
 *
 * 模型不该靠猜：需要人做决定时（选方案、确认取舍、补充信息）它调用这个工具，
 * 服务层把问题经交互中转（`interaction/ui-broker`）发给该会话的所有 attachment，
 * 拿到回答再交回模型。
 *
 * 两条降级路径都必须**明确失败**而不是挂住整轮：
 * - 这条通路没有可承载交互的 attachment（`ui` 不可用）→ 直接报错，让模型自己判断；
 * - 提问超时/无人应答 → 同样报错，并在文案里告诉模型"按最佳判断继续、说明假设"。
 */

/** 单次提问最多给几个选项：太多选项在终端里难选，超过就请模型自己收窄。 */
const MAX_OPTIONS = 6;

export type QuestionParams = {
  question: string;
  options?: string[];
  placeholder?: string;
};

export type QuestionDetails = {
  question: string;
  mode: "choose" | "freeform";
  answer: string;
};

/**
 * 提问的实现（与工具定义分开：这样它是可以直接单测的纯函数）。
 *
 * 无人应答一律抛错——**不返回空答案**：空答案会被模型当成"用户说没有"，
 * 与"用户没理我"是两回事。
 */
export async function askUser(
  ui: ExtensionUIContext | undefined,
  params: QuestionParams,
): Promise<{ text: string; details: QuestionDetails }> {
  const question = params.question.trim();
  if (question === "") throw new Error("question 不能为空。");
  if (ui === undefined) {
    throw new Error(
      "当前通路没有可承载交互的界面（没有能应答的 attachment）。不要等：按你的最佳判断继续，并在结果里说明你做了哪些假设。",
    );
  }

  const options = (params.options ?? []).map((option) => option.trim()).filter((o) => o !== "");
  if (options.length > MAX_OPTIONS) {
    throw new Error(
      `选项最多 ${MAX_OPTIONS} 项（收到 ${options.length} 项）：请收窄到几个可选方案再问。`,
    );
  }

  if (options.length > 0) {
    const choice = await ui.select(question, options);
    if (choice === undefined) throw new Error(unanswered(question));
    return {
      text: `用户选择了：${choice}`,
      details: { question, mode: "choose", answer: choice },
    };
  }

  const answer = await ui.input(question, params.placeholder);
  if (answer === undefined || answer.trim() === "") throw new Error(unanswered(question));
  return {
    text: `用户回答：${answer.trim()}`,
    details: { question, mode: "freeform", answer: answer.trim() },
  };
}

function unanswered(question: string): string {
  return `提问没有得到回答（超时、被取消，或没有能应答的控制层）：${question}。不要继续等：按你的最佳判断继续，并在结果里说明你做了哪些假设。`;
}

export const questionTool = {
  name: "question",
  label: "提问",
  description:
    "向用户提问并等待回答。需要人做决定时用它（选方案、确认取舍、补充只有用户知道的信息），不要自己猜。" +
    "给了 options 就是单选，否则是自由输入。",
  parameters: Type.Object({
    question: Type.String({ description: "要问的问题（一句话，带上必要的上下文）" }),
    options: Type.Optional(
      Type.Array(Type.String(), {
        description: `候选选项（最多 ${MAX_OPTIONS} 项）；给了就让人选，否则自由输入`,
      }),
    ),
    placeholder: Type.Optional(Type.String({ description: "自由输入时的提示语" })),
  }),

  async execute(
    _toolCallId: string,
    params: QuestionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: { ui?: ExtensionUIContext },
  ): Promise<AgentToolResult<QuestionDetails>> {
    const outcome = await askUser(ctx?.ui, params);
    return { content: [{ type: "text", text: outcome.text }], details: outcome.details };
  },
};

export function createQuestionExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    pi.registerTool(questionTool as never);
  };
}
