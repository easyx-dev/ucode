import type { MemoryFact } from "./record.ts";

/**
 * 把记忆渲染成系统提示的一个 section（F-2.5）。
 *
 * 只放**索引**（名字 + 一句话描述），不放全文——全文由 agent 需要时用 `memory` 工具读。
 * 这既控制了提示体积，也让"记什么"保持显式：模型看得到它记得什么、但不被全文淹没。
 */

export const DEFAULT_MEMORY_MAX_BYTES = 25 * 1024;
export const DEFAULT_MEMORY_MAX_LINES = 200;

export type MemoryPromptOptions = {
  maxBytes?: number;
  maxLines?: number;
};

export function buildMemoryPrompt(
  facts: MemoryFact[],
  opts: MemoryPromptOptions = {},
): string | null {
  if (facts.length === 0) return null;
  const maxBytes = opts.maxBytes ?? DEFAULT_MEMORY_MAX_BYTES;
  const maxLines = opts.maxLines ?? DEFAULT_MEMORY_MAX_LINES;

  const lines: string[] = [
    "以下是你为这个工作区记住的长期事实（按需用 memory 工具读取全文，或写入新事实）。",
    "除非与当前代码/指令冲突，把它们当作既有知识；冲突时以当前事实为准并更新记忆。",
    "",
  ];
  for (const fact of facts) {
    const description = fact.description.length > 0 ? ` — ${fact.description}` : "";
    lines.push(`- ${fact.name}${description}`);
  }

  let text = lines.join("\n");
  let truncated = false;
  if (lines.length > maxLines) {
    text = lines.slice(0, maxLines).join("\n");
    truncated = true;
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
    truncated = true;
  }
  if (truncated) {
    text += "\n\n（记忆索引过长已截断，可用 memory 工具读取完整列表。）";
  }
  return text;
}
