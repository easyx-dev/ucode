/**
 * 提示词命令与技能命令的展开：`/name args` → `<command …>`，`/skill:name args` → `<skill …>`。
 *
 * 不能交给 pi：它的 `expandPromptTemplate` / `_expandSkillCommand` 都把整条消息换成模板 / 技能正文
 * 再落进会话文件，客户端从此认不出这是哪一条命令，也就画不出 chip；两者的守卫又都要求**整条输入以
 * `/`（或 `/skill:`）开头**，而我们总是把 `@` 引用与附件引用行拼在正文之前，于是带引用的命令连展开都
 * 不会发生。所以在投递前自己展开，用与 `<context>` 同形的边界保住块边界——正文与参数都可能含同名标签。
 *
 * 占位语义对齐 pi 的 `parseCommandArgs` / `substituteArgs`（两者未从包入口导出，故在此实现并单测），
 * 技能块的字面形状也与 pi 一致（正文读文件后去 frontmatter），客户端照同一形状还原。
 */
import { readFileSync } from "node:fs";

import { type PromptTemplate, type Skill, stripFrontmatter } from "@earendil-works/pi-coding-agent";

import { wrapUntrusted } from "../tools/untrusted";

/** 整条输入就是一条命令：`/name` 或 `/name args`（参数可跨行） */
const COMMAND_PATTERN = /^\/([^\s]+)(?:\s+([\s\S]*))?$/;

/** 整条输入就是一次技能调用：`/skill:name` 或 `/skill:name args` */
const SKILL_PATTERN = /^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/;

/** 一条占位；分组顺序与 pi 的实现逐字对应，便于两处对照 */
const PLACEHOLDER_PATTERN =
  /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g;

/** 按 bash 风格拆参数：引号内的空白不切分，引号本身丢弃 */
export const parseCommandArgs = (input: string): string[] => {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of input) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
};

/** 替换模板里的占位；参数与默认值里的占位不再递归展开（与 pi 同） */
export const substituteArgs = (content: string, args: readonly string[]): string => {
  const all = args.join(" ");
  return content.replace(
    PLACEHOLDER_PATTERN,
    (_match, defaultValueOf, fallback, sliceStart, sliceLength, simple) => {
      if (typeof defaultValueOf === "string" && defaultValueOf !== "") {
        const value =
          defaultValueOf === "@" || defaultValueOf === "ARGUMENTS"
            ? all
            : args[Number.parseInt(defaultValueOf, 10) - 1];
        return value ? value : (fallback as string);
      }
      if (typeof sliceStart === "string" && sliceStart !== "") {
        // 用户给的序号从 1 起，0 按 bash 惯例也当第一项
        const start = Math.max(Number.parseInt(sliceStart, 10) - 1, 0);
        return (
          typeof sliceLength === "string"
            ? args.slice(start, start + Number.parseInt(sliceLength, 10))
            : args.slice(start)
        ).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") return all;
      return args[Number.parseInt(simple as string, 10) - 1] ?? "";
    },
  );
};

export type ExpandedInvocation = {
  /** 命令名（模板文件名，不含 `.md`）或技能名 */
  name: string;
  /** 原样传给模板 / 技能的参数串，界面 chip 后面跟的正文就是它 */
  args: string;
  /** 边界块：正文已中和同名标签，属性已转义，可直接拼进投递正文 */
  block: string;
};

/**
 * 整条输入是一条已知提示词命令时展开；不是命令、或没有同名模板时返回 null（按普通消息投递）。
 * 展开后的块以 `<` 开头，pi 侧的模板展开不会重复触发。
 */
export const expandCommand = (
  text: string,
  templates: readonly PromptTemplate[],
): ExpandedInvocation | null => {
  const match = COMMAND_PATTERN.exec(text);
  const name = match?.[1];
  if (!name) return null;
  const template = templates.find((item) => item.name === name);
  if (!template) return null;

  const args = match[2] ?? "";
  const body = substituteArgs(template.content, parseCommandArgs(args));
  return { name, args, block: wrapUntrusted("command", { name, args }, body) };
};

/**
 * 整条输入是一次已知技能调用时展开；不是技能调用、没有同名技能或技能正文读不出来时返回 null。
 * 读懂失败（文件被删 / 权限不足）按普通消息投递——不把投递卡在一条读不到的技能上。
 */
export const expandSkillCommand = (
  text: string,
  skills: readonly Skill[],
): ExpandedInvocation | null => {
  const match = SKILL_PATTERN.exec(text);
  const name = match?.[1];
  if (!name) return null;
  const skill = skills.find((item) => item.name === name);
  if (!skill) return null;

  let body: string;
  try {
    body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
  } catch {
    return null;
  }
  // 字面形状与 pi 的 `_expandSkillCommand` 一致：块内先声明「相对路径的基准」，参数接在块后
  const args = (match[2] ?? "").trim();
  const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
  return { name, args, block: args ? `${block}\n\n${args}` : block };
};
