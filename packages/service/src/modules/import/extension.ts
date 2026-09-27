import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { importExternalSources, summarizeImport } from "./apply.ts";
import { discoverExternalSources, type ImportKind, kindLabel } from "./sources.ts";

/**
 * 导入外部 Agent 资源的工具（F-3.9）。
 *
 * 注意：导入的是**提示与定义**（技能/命令/子智能体/上下文），不是可执行代码——但它们会影响
 * 模型行为，因此这个工具按"改动类"受批准门槛约束（import 会往数据层写文件）。
 */

export type ImportExtensionOptions = { dataDir: string; cwd: string };

const KINDS: ImportKind[] = ["skill", "command", "agent", "context", "mcp"];

type ImportToolDetails = { action: string; found?: number; imported?: number; skipped?: number };

export function createImportExtension(options: ImportExtensionOptions): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const tool = defineTool({
      name: "import_external",
      label: "Import external agent resources",
      description:
        "把其它 agent 的配置导入进来（技能/命令/子智能体/上下文/MCP 声明）。action=scan 先列出发现了什么；" +
        "action=apply 复制进数据层（只读源目录、不覆盖已有同名文件、并留下 importedFrom 来源标记）。" +
        "认得的布局：.claude-plugin / .agents / commands / agents / skills / AGENTS.md / .mcp.json。",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("scan"), Type.Literal("apply")], {
          description: "默认 scan",
        }),
        path: Type.Optional(Type.String({ description: "外部目录根（默认当前工作目录）" })),
        overwrite: Type.Optional(
          Type.Boolean({ description: "apply 时覆盖已存在的同名文件（默认 false）" }),
        ),
      }),

      async execute(_toolCallId, params): Promise<AgentToolResult<ImportToolDetails>> {
        const root = params.path ?? options.cwd;
        const action = params.action ?? "scan";

        if (action === "scan") {
          const found = await discoverExternalSources(root);
          if (found.length === 0) {
            return {
              content: [{ type: "text", text: `在 ${root} 下没有认出任何外部 agent 资源。` }],
              details: { action: "scan", found: 0 },
            };
          }
          const lines = found.map(
            (source) =>
              `- [${kindLabel(source.kind)}] ${source.name} ← ${source.relativePath}（${source.origin}）`,
          );
          return {
            content: [
              {
                type: "text",
                text: `在 ${root} 发现 ${found.length} 项（导入只复制，不改源目录）：\n${lines.join("\n")}`,
              },
            ],
            details: { action: "scan", found: found.length },
          };
        }

        const report = await importExternalSources({
          dataDir: options.dataDir,
          root,
          ...(params.overwrite === undefined ? {} : { overwrite: params.overwrite }),
        });
        const detail = report.imported
          .map((entry) => `- [${kindLabel(entry.kind)}] ${entry.name} → ${entry.to}`)
          .join("\n");
        const skipped =
          report.skipped.length === 0
            ? ""
            : `\n跳过的：\n${report.skipped
                .map(
                  (entry) =>
                    `- ${entry.name}（${entry.reason === "exists" ? "已存在" : "读取失败"}）`,
                )
                .join("\n")}`;
        return {
          content: [
            {
              type: "text",
              text: `${summarizeImport(report)}${detail === "" ? "" : `\n${detail}`}${skipped}`,
            },
          ],
          details: {
            action: "apply",
            found: report.imported.length + report.skipped.length,
            imported: report.imported.length,
            skipped: report.skipped.length,
          },
        };
      },
    });

    pi.registerTool(tool);
  };
}

export { KINDS };
