/**
 * 记忆工具：remember / forget，让模型按用户的明确指令直接增删项目记忆。
 *
 * 只在 build 模式注册（见 `session-config`）：写入记忆是持久化副作用，与写盘能力同档；
 * plan / ask 这类只读模式不注册（它们的工具声明与 build 一致，记忆工具不在其中），自动回顾不受影响。
 */
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { forgetFacts, rememberFact } from "./store";

/** 记忆工具名：默认集之外的 `customTools`，提示词的可用工具清单要单独补上 */
export const MEMORY_TOOL_NAMES = ["remember", "forget"] as const;

export const createMemoryTools = (cwd: string, appDir: string): ToolDefinition[] => [
  defineTool({
    name: "remember",
    label: "remember",
    description: "把用户明确要求长期保留的信息写入项目记忆，后续会话会自动带上。",
    promptSnippet: "写入项目长期记忆",
    promptGuidelines: [
      "只在用户明确要求「记住」时调用，不要自作主张保存。",
      "只保存用户偏好、纠正、项目约束、外部资料线索这类长期有效的事实；临时代码结构与已有文档里的内容不要记。",
      "title 用简短可检索的标题，content 写成脱离本轮对话也能读懂的事实。",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "记忆标题，简短且便于检索" }),
      content: Type.String({ description: "记忆正文，写成独立可读的事实" }),
    }),
    execute: async (_toolCallId, { title, content }) => {
      const entry = rememberFact(cwd, { title, content }, appDir);
      return {
        content: [{ type: "text", text: `已记住「${entry.title}」（${entry.file}）。` }],
        details: { file: entry.file },
      };
    },
  }),
  defineTool({
    name: "forget",
    label: "forget",
    description: "从项目记忆中删除匹配的事实，供用户要求「忘掉」时使用。",
    promptSnippet: "删除项目长期记忆",
    promptGuidelines: [
      "只在用户明确要求「忘掉」时调用，query 用能定位到那条记忆的关键词。",
      "删除前先确认用户指的是哪条记忆；不确定就先问，不要误删无关记忆。",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "要忘掉的内容关键词，用于匹配标题、描述或正文" }),
    }),
    execute: async (_toolCallId, { query }) => {
      const deleted = forgetFacts(cwd, query, appDir);
      const text =
        deleted.length > 0
          ? `已忘掉：${deleted.map((entry) => entry.title).join("、")}。`
          : "没有找到匹配的记忆，未做改动。";
      return {
        content: [{ type: "text", text }],
        details: { deleted: deleted.map((entry) => entry.file) },
      };
    },
  }),
];
