import type { AgentToolResult, ExtensionAPI, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { collectWikiSources } from "./collect.ts";
import { summarizeExclusions } from "./filter.ts";
import { generateWiki, readWiki, wikiFileFor } from "./generate.ts";

/**
 * Wiki 生成工具（F-2.6）：`wiki` 工具，`action=generate` 生成并落盘，`action=read` 读回。
 *
 * 让 agent 自己触发是刻意的：用户问"这个项目大概怎么组织"时，与其让它逐个文件读，
 * 不如让它生成/读取一份结构化 Wiki，再基于 Wiki 回答——省上下文，也可复用。
 */

export type WikiExtensionOptions = {
  dataDir: string;
  cwd: string;
  modelRuntime: ModelRuntime;
};

type WikiToolDetails = { action: string; files?: number; excluded?: number; file?: string };

export function createWikiExtension(options: WikiExtensionOptions): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const tool = defineTool({
      name: "wiki",
      label: "Project wiki",
      description:
        "生成或读取这个项目的 Wiki（Markdown）。action=generate 遍历工作区、排除依赖/构建产物/敏感文件后生成；" +
        "action=read 读回已生成的 Wiki。想快速了解项目结构时先 read，没有再用 generate。",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("generate"), Type.Literal("read")], {
          description: "默认 read",
        }),
        instructions: Type.Optional(
          Type.String({ description: "generate 时的附加取向，例如「侧重架构与数据流」" }),
        ),
      }),

      async execute(_toolCallId, params): Promise<AgentToolResult<WikiToolDetails>> {
        const action = params.action ?? "read";

        if (action === "read") {
          const existing = await readWiki(options.dataDir, options.cwd);
          if (existing === null) {
            return {
              content: [{ type: "text", text: "还没有生成过 Wiki。用 action=generate 生成一份。" }],
              details: { action: "read" },
            };
          }
          return { content: [{ type: "text", text: existing }], details: { action: "read" } };
        }

        const collection = await collectWikiSources(options.cwd);
        if (collection.files.length === 0) {
          return {
            content: [{ type: "text", text: "没有可读的源文件（可能全被过滤规则排除了）。" }],
            details: { action: "generate", files: 0, excluded: collection.excluded.length },
          };
        }
        const result = await generateWiki({
          cwd: options.cwd,
          dataDir: options.dataDir,
          modelRuntime: options.modelRuntime,
          collection,
          ...(params.instructions === undefined ? {} : { instructions: params.instructions }),
        });
        const summary = summarizeExclusions(collection.excluded);
        const budgetNote = collection.truncatedByBudget
          ? "（已达读取预算上限，Wiki 只覆盖了部分文件。）"
          : "";
        return {
          content: [
            {
              type: "text",
              text: `已生成 Wiki（${collection.files.length} 个源文件）→ ${result.file}\n${summary}${budgetNote}`,
            },
          ],
          details: {
            action: "generate",
            files: collection.files.length,
            excluded: collection.excluded.length,
            file: result.file,
          },
        };
      },
    });

    pi.registerTool(tool);
  };
}

export { wikiFileFor };
