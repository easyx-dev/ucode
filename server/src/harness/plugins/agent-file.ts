/**
 * 插件角色的读取：`agents/*.md` 走 Claude 语义，一律落成**子角色**。
 *
 * 与自定义角色（`harness/setup/agents/custom.ts`）的两处关键差别：
 * - 宽松解析：插件作者写的 Claude 专属字段（`effort` / `color` 等）只出诊断，不让整个角色文件失败——
 *   那是别人的生态，不认识不等于写错了；
 * - slug 带插件前缀（`<pluginToken>-<agentToken>`），与项目 / 全局角色天然分处两个命名空间；
 *   `mode` 字段不解释：插件角色不做主模式。
 */
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { PluginDiagnosticView } from "@ucode/contracts";

import { CUSTOM_AGENT_MAX_BYTES } from "../../constants/agents";
import { MARKDOWN_EXTENSION } from "../../constants/dirs";
import { diagnostic } from "./diagnostic";
import { toComponentToken } from "./sanitize";
import type { PluginAgentFile } from "./types";

/** Claude 工具名 → pi 工具名；表外的名字按诊断丢弃，不静默换成别的工具 */
const TOOL_NAME_MAP: Record<string, string> = {
  Bash: "bash",
  Read: "read",
  Edit: "edit",
  Write: "write",
  Glob: "find",
  Grep: "grep",
  LS: "ls",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  Task: "subagent",
};

/** Claude 的模型别名在本产品里没有对应物，忽略并回落会话默认 */
const MODEL_ALIASES = ["sonnet", "opus", "haiku", "inherit"];

/** 认识的字段；其余一律只出诊断 */
const KNOWN_FIELDS = new Set(["name", "description", "tools", "disallowedTools", "model", "mode"]);

const toText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** `tools` 既接受逗号分隔的字符串，也接受数组（Claude 两种都认） */
const toNameList = (value: unknown): string[] | null => {
  const items = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : null;
  if (!items) return null;
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

/** 工具名映射：返回 pi 侧名字，表外的名字记诊断后丢弃 */
const mapToolNames = (
  names: readonly string[],
  file: string,
  diagnostics: PluginDiagnosticView[],
): string[] => {
  const mapped: string[] = [];
  for (const name of names) {
    const tool = TOOL_NAME_MAP[name] ?? (name === name.toLowerCase() ? name : undefined);
    if (!tool) {
      diagnostics.push(diagnostic("warning", "agents", `${file}：工具名 ${name} 不认识，已忽略`));
      continue;
    }
    mapped.push(tool);
  }
  return mapped;
};

export type PluginAgentLoad = {
  agents: PluginAgentFile[];
  diagnostics: PluginDiagnosticView[];
};

/**
 * 解析一个插件的全部角色文件。单个文件失败只跳过它——坏的不是整包。
 * `taken` 是跨插件的 slug 占用集合，同 token 冲突时按组件命名规则加哈希后缀。
 */
export const loadPluginAgents = (input: {
  pluginName: string;
  files: readonly string[];
  taken: Set<string>;
}): PluginAgentLoad => {
  const agents: PluginAgentFile[] = [];
  const diagnostics: PluginDiagnosticView[] = [];

  for (const file of input.files) {
    const name = basename(file);
    const fail = (reason: string): void => {
      diagnostics.push(diagnostic("error", "agents", `${name}：${reason}`));
    };

    let content: string;
    try {
      if (statSync(file).size > CUSTOM_AGENT_MAX_BYTES) {
        fail("文件过大");
        continue;
      }
      content = readFileSync(file, "utf8");
    } catch (error) {
      fail(`读不出来（${error instanceof Error ? error.message : String(error)}）`);
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content);
    const description = toText(frontmatter.description);
    const promptSection = body.trim();
    if (!description) {
      fail("缺少 description，已跳过");
      continue;
    }
    if (!promptSection) {
      fail("缺少提示词正文，已跳过");
      continue;
    }

    for (const key of Object.keys(frontmatter)) {
      if (KNOWN_FIELDS.has(key)) continue;
      diagnostics.push(
        diagnostic("info", "agents", `${name}：字段 ${key} 不是本产品认识的，已忽略`),
      );
    }
    if (frontmatter.mode !== undefined) {
      diagnostics.push(
        diagnostic(
          "info",
          "agents",
          `${name}：插件角色不做主模式，mode 已忽略（一律按子角色落位）`,
        ),
      );
    }

    const declaredModel = toText(frontmatter.model);
    let model: string | undefined;
    if (declaredModel) {
      if (MODEL_ALIASES.includes(declaredModel)) {
        diagnostics.push(
          diagnostic(
            "info",
            "agents",
            `${name}：模型别名 ${declaredModel} 无对应物，已回落会话默认`,
          ),
        );
      } else {
        model = declaredModel;
      }
    }

    const localName = toText(frontmatter.name) ?? name.slice(0, -MARKDOWN_EXTENSION.length);
    const slug = toComponentToken(input.pluginName, localName, input.taken);
    // 认领这个 slug：跨插件的同名 token 靠这个集合发现冲突并加哈希后缀
    input.taken.add(slug);
    agents.push({
      slug,
      label: localName,
      description,
      promptSection,
      tools: mapToolNames(toNameList(frontmatter.tools) ?? [], name, diagnostics),
      disallowedTools: mapToolNames(
        toNameList(frontmatter.disallowedTools) ?? [],
        name,
        diagnostics,
      ),
      ...(model ? { model } : {}),
    });
  }

  return { agents, diagnostics };
};
