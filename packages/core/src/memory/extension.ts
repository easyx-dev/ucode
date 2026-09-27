import { join } from "node:path";
import {
  type AgentToolResult,
  defineTool,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { storePaths } from "@ucode/store";
import { Type } from "typebox";
import { isMemoryType, projectMemoryDir } from "./paths.ts";
import { buildMemoryPrompt } from "./prompt.ts";
import { deleteMemoryFact, listMemoryFacts, readMemoryFact, writeMemoryFact } from "./store.ts";

/**
 * 记忆扩展（F-2.5）：把"项目级持久记忆"接到基座的 agent loop 上。
 *
 * 两个接口：
 * - **读**：`before_agent_start` 时把记忆索引注入系统提示的一个 section（只注索引，不注全文）；
 * - **写**：注册 `memory` 工具，让 agent 自己决定记什么、忘什么。
 *
 * 记忆按 `cwd` 隔离（`memories/projects/<slug>-<hash>`），因此"仅主对话生效"是结构性的：
 * 子智能体若换了 cwd 就看不到，若同 cwd 则共享——这是有意的（同一项目的事实对谁都成立）。
 */

export type MemoryExtensionOptions = {
  /** 数据层目录。 */
  dataDir: string;
  /** 工作目录（决定记忆归属哪个项目）。 */
  cwd: string;
};

type MemoryToolDetails = {
  action: string;
  name?: string;
  type?: string;
  count?: number;
  removed?: boolean;
};

export function createMemoryExtension(options: MemoryExtensionOptions): (pi: ExtensionAPI) => void {
  const memoryDir = projectMemoryDir(storePaths(options.dataDir).memories, options.cwd);

  const memoryTool = defineTool({
    name: "memory",
    label: "Memory",
    description:
      "管理这个工作区的长期记忆。action=list 列出全部条目；read 读全文；write 新增或覆盖一条；delete 删除一条。只在" +
      "学到跨会话仍然成立、且从代码里看不出来的事实时才写入（用户的偏好、项目的约定、踩过的坑）。",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("read"),
        Type.Literal("write"),
        Type.Literal("delete"),
      ]),
      name: Type.Optional(
        Type.String({ description: "条目名（小写字母/数字/._-，write 与 read/delete 必填）" }),
      ),
      description: Type.Optional(
        Type.String({ description: "一句话描述（write 必填，会进系统提示的索引）" }),
      ),
      type: Type.Optional(
        Type.String({ description: "分类：user | feedback | project | reference（默认 project）" }),
      ),
      body: Type.Optional(Type.String({ description: "条目正文（write 必填）" })),
    }),

    async execute(_toolCallId, params): Promise<AgentToolResult<MemoryToolDetails>> {
      // 基座的工具契约里"失败"是抛错（结果类型没有 isError 字段）。
      const fail = (text: string): never => {
        throw new Error(text);
      };
      const ok = (
        text: string,
        details: MemoryToolDetails = { action: params.action },
      ): AgentToolResult<MemoryToolDetails> => ({
        content: [{ type: "text", text }],
        details,
      });

      switch (params.action) {
        case "list": {
          const facts = await listMemoryFacts(memoryDir);
          if (facts.length === 0) return ok("（这个工作区还没有任何记忆。）");
          const text = facts
            .map((fact) => `${fact.name} [${fact.type}] — ${fact.description}`)
            .join("\n");
          return ok(text, { action: "list", count: facts.length });
        }
        case "read": {
          if (params.name === undefined) return fail("read 需要 name 参数。");
          const fact = await readMemoryFact(memoryDir, params.name);
          if (fact === null) return fail(`没有名为 ${params.name} 的记忆。`);
          return ok(`# ${fact.name}\n${fact.description}\n\n${fact.body}`, {
            action: "read",
            name: fact.name,
            type: fact.type,
          });
        }
        case "write": {
          const missing = requireFields(params, ["name", "description", "body"]);
          if (missing !== null) return fail(`write 缺少必填参数：${missing}。`);
          const type = isMemoryType(params.type) ? params.type : "project";
          const fact = await writeMemoryFact(memoryDir, {
            name: params.name as string,
            description: params.description as string,
            type,
            body: params.body as string,
          });
          return ok(`已记住 ${fact.name}（${fact.type}）。`, {
            action: "write",
            name: fact.name,
            type: fact.type,
          });
        }
        case "delete": {
          if (params.name === undefined) return fail("delete 需要 name 参数。");
          const removed = await deleteMemoryFact(memoryDir, params.name);
          if (!removed) return fail(`没有名为 ${params.name} 的记忆。`);
          return ok(`已忘记 ${params.name}。`, {
            action: "delete",
            name: params.name,
            removed: true,
          });
        }
      }
    },
  });

  return (pi: ExtensionAPI): void => {
    pi.registerTool(memoryTool);

    pi.on("before_agent_start", async (event) => {
      const facts = await listMemoryFacts(memoryDir);
      const section = buildMemoryPrompt(facts);
      if (section === null) return;
      event.systemPromptOptions.sections.memory = section;
    });
  };
}

function requireFields(params: Record<string, unknown>, fields: string[]): string | null {
  const missing = fields.filter(
    (field) => typeof params[field] !== "string" || params[field] === "",
  );
  return missing.length === 0 ? null : missing.join("、");
}

/** 记忆目录（供协议层读取，UI 展示用）。 */
export function memoryDirFor(dataDir: string, cwd: string): string {
  return projectMemoryDir(storePaths(dataDir).memories, cwd);
}

// 便于测试直接构造路径。
export function memoryIndexFileFor(dataDir: string, cwd: string): string {
  return join(memoryDirFor(dataDir, cwd), "MEMORY.md");
}
