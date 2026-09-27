import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  type FrontmatterFields,
  splitFrontmatter,
} from "../../util/frontmatter.ts";

/**
 * 子智能体定义（F-3.3）：Markdown + frontmatter。
 *
 *   ---
 *   name: reviewer
 *   description: 审查改动，只读，不写代码
 *   tools: [read, grep, find, ls]
 *   background: false
 *   maxTurns: 12
 *   ---
 *   你是一个只读审查者……
 *
 * frontmatter 只管"怎么跑"，正文是它的系统提示——与 Claude Code / pi 的 agent 定义同构，
 * 因此 F-3.9 导入外部 Agent 时不需要翻译层。
 */

export type SubagentProfile = {
  name: string;
  description: string;
  /** 工具白名单（省略 = 继承通用工具集）。 */
  tools?: string[];
  /** 显式禁用的工具（与白名单叠加，禁用优先）。 */
  disallowedTools?: string[];
  /** 默认后台运行（调用方仍可用参数覆盖）。 */
  background?: boolean;
  /** 轮次护栏：超过则中止，避免子智能体打转。 */
  maxTurns?: number;
  /** 系统提示（Markdown 正文）。 */
  systemPrompt: string;
  /** 来源：内置名或文件路径。 */
  source: string;
};

const GENERAL_PURPOSE_PROMPT = [
  "你是被主对话派来的子智能体。给定任务后，用可用工具把它做完：不要镀金，也不要只做一半。",
  "完成后给一份**简洁**的报告，说明做了什么、关键发现是什么——主对话会把它转达给用户，所以只需要要点。",
  "",
  "你的长处：在大型代码库里搜寻代码与配置、跨多个文件分析架构、调查需要读很多文件的问题。",
  "准则：不确定位置时先宽后窄地搜索；已知路径时直接读；不要创建非必要的文件，优先编辑而非新建。",
].join("\n");

const EXPLORE_PROMPT = [
  "你是只读的探索子智能体。**禁止修改任何文件**——只能读、搜、列目录。",
  "任务是把探索结果讲清楚：相关文件在哪、关键实现是什么、有哪些值得注意的约束。",
  "报告要简洁、有路径可循，方便主对话直接引用。",
].join("\n");

/** 探索型子智能体只给只读工具（与定义一起构成"结构性只读"）。 */
const EXPLORE_TOOLS = ["read", "grep", "find", "ls"];

export const BUILTIN_PROFILES: readonly SubagentProfile[] = [
  {
    name: "general-purpose",
    description: "通用子智能体：多步研究、跨文件分析、可读写。",
    systemPrompt: GENERAL_PURPOSE_PROMPT,
    source: "builtin:general-purpose",
  },
  {
    name: "explore",
    description: "只读探索子智能体：搜寻代码、读文件、梳理结构，不改动任何东西。",
    tools: EXPLORE_TOOLS,
    systemPrompt: EXPLORE_PROMPT,
    source: "builtin:explore",
  },
];

export const SUBAGENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

export function isSafeSubagentName(name: string): boolean {
  return SUBAGENT_NAME_PATTERN.test(name) && name !== "." && name !== "..";
}

export function parseSubagentProfile(
  markdown: string,
  source: string,
  fallbackName: string,
): SubagentProfile | string {
  const { fields, body } = splitFrontmatter(markdown);
  const name = asString(fields.name) ?? fallbackName;
  if (!isSafeSubagentName(name)) {
    return `${source}: 非法的子智能体名 ${name}（只允许字母/数字/._-）。`;
  }
  const systemPrompt = body.trim();
  const description = asString(fields.description) ?? firstLine(systemPrompt);
  if (description === "") {
    return `${source}: 缺少 description（frontmatter 或正文首行）。`;
  }
  const profile: SubagentProfile = { name, description, systemPrompt, source };
  const tools = readTools(fields, "tools");
  if (tools !== undefined) profile.tools = tools;
  const disallowed = readTools(fields, "disallowedTools");
  if (disallowed !== undefined) profile.disallowedTools = disallowed;
  const background = asBoolean(fields.background);
  if (background !== undefined) profile.background = background;
  const maxTurns = asNumber(fields.maxTurns);
  if (maxTurns !== undefined && maxTurns > 0) profile.maxTurns = maxTurns;
  return profile;
}

/** 只接受非空字符串列表；`tools:` 下的空块（如嵌套 mapping）不接受，避免意外放大权限。 */
function readTools(fields: FrontmatterFields, key: string): string[] | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  const list = asStringArray(value);
  if (list === undefined || list.length === 0) return undefined;
  return list;
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed.slice(0, 200);
  }
  return "";
}
