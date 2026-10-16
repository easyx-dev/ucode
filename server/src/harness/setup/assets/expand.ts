/**
 * 提示词命令与技能命令的展开：客户端给出「调用了哪条命令」（`command` / `skills`）+ 用户正文，
 * 这里查模板 / 读技能正文，换成带边界块的投递文本。
 *
 * 名字与参数的边界由客户端在发送前定形（见 `docs/api.md`「输入载荷」），所以这里不再解析
 * `/name args`：正文原样就是参数（`$ARGUMENTS` 等占位按它替换）。原先用正则判断「整条输入是不是
 * 命令」时会切错边界：用户那句里的标点被当成命令与参数的分隔，参数就少了一段或多了一段。
 *
 * 边界块同时是客户端认出「这是一条命令 / 技能」的依据，必须落在会话条目里。不能交给 pi：它的
 * `expandPromptTemplate` / `_expandSkillCommand` 都把整条消息换成模板 / 技能正文再落进会话文件，
 * 客户端从此认不出这是哪一条命令，也就画不出 chip；两者的守卫又都要求**整条输入以 `/`（或
 * `/skill:`）开头**，而正文里还带着 `@` 引用与附件的标记，于是带引用的命令连展开都不会发生。
 *
 * 占位语义对齐 pi 的 `parseCommandArgs` / `substituteArgs`（两者未从包入口导出，故在此实现并单测），
 * 技能块的字面形状也与 pi 一致（正文读文件后去 frontmatter）。
 */
import { readFileSync } from "node:fs";

import { type PromptTemplate, type Skill, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { SKILL_TAG } from "@ucode/contracts";

import { wrapUntrusted } from "../../utils/boundary";

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
  /** 用户写的正文：既是模板占位与技能块后跟着的那份文本，也是界面 chip 之后显示的正文 */
  args: string;
  /** 边界块：正文已中和同名标签，属性已转义，可直接拼进投递正文 */
  block: string;
};

/**
 * 一条提示词命令：按名查模板，把占位换成用户正文，再包上边界块。
 * 没有同名模板时返回 null（调用方报错——客户端定形过的命令名对不上服务端清单，
 * 静默当普通消息投递只会让用户写的参数变成字面文本）。
 */
export const expandPromptInvocation = (
  name: string,
  args: string,
  templates: readonly PromptTemplate[],
): ExpandedInvocation | null => {
  const template = templates.find((item) => item.name === name);
  if (!template) return null;
  const body = substituteArgs(template.content, parseCommandArgs(args));
  return { name, args, block: wrapUntrusted("command", { name, args }, body) };
};

/**
 * 一次技能调用：正文读文件后去 frontmatter，参数进属性——与 `<command>` 对称，且一条消息里
 * 多条技能时各自参数不会糊在一起（块后接参数的写法无法分辨「这条参数属于哪个技能」）。
 *
 * 没有同名技能或正文读不出来时返回 null（调用方报错）。
 */
export const expandSkillInvocation = (
  name: string,
  args: string,
  skills: readonly Skill[],
): ExpandedInvocation | null => {
  const skill = skills.find((item) => item.name === name);
  if (!skill) return null;

  let body: string;
  try {
    body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
  } catch {
    return null;
  }
  // 与 `<command>` 一样走边界包裹：技能正文可以由第三方插件带来，不中和就能用 `</skill>` 逃出边界
  const block = wrapUntrusted(
    SKILL_TAG,
    { name: skill.name, location: skill.filePath, args },
    `References are relative to ${skill.baseDir}.\n\n${body}`,
  );
  return { name, args, block };
};
