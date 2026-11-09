/**
 * 输入区文档 → 方言文本 → 载荷：发送与编辑重发共用这一条路径。
 *
 * 文档只是方言的**视图**（芯片），被持久化与投递的那份东西是方言文本；发送前在这一处解析，服务端
 * 因此只认结构化字段（`command` / `skills` / 标记形态的正文），不再从文本里切 `/name`。
 *
 * 诊断分两档返回：阻断项（名字不在清单、多条命令、容器未闭合）由调用方拦下发送，其余只提示。
 */
import type { PromptCommandView, SkillCommandView } from "@ucode/contracts";
import type { DialectDiagnostic, DocNode } from "@ucode/markdown";
import { docToDialect, isBlockingDiagnostic, parseDialect } from "@ucode/markdown";
import type { TFunction } from "i18next";
import { BUILTIN_COMMANDS } from "../builtin-commands";

import type { ComposerPayload } from "./composer-payload";

/** 留给客户端自己解析的内置动作名（`/goal` 等）：不在这里当命令容器 */
export const RESERVED_COMMAND_NAMES: readonly string[] = BUILTIN_COMMANDS.map((item) => item.name);

export type DialectResult = {
  payload: ComposerPayload;
  /** 阻断发送的诊断；非空时调用方不该投递 */
  blocking: DialectDiagnostic[];
  /** 只提示、不阻断（附件 scheme 写错之类） */
  warnings: DialectDiagnostic[];
  /** 这条输入要注入的技能条数与正文体积：技能不限条数，界面据此提示上下文占用 */
  skillCost: { count: number; bytes: number };
};

/** 清单由 `commands/list` 给：名字用于校验，`bytes` 用于估计注入体积 */
export type CommandAssets = {
  prompts: readonly PromptCommandView[];
  skills: readonly SkillCommandView[];
};

export const payloadOfDoc = (
  doc: DocNode | null | undefined,
  commands: CommandAssets,
  /** 引用锚点的 scheme 表（插件贡献）：表内的 `@scheme:…` 不当文件引用 */
  mentions: readonly string[] = [],
): DialectResult => {
  const dialect = docToDialect(doc, {
    candidates: { ...commands, mentions },
    reserved: RESERVED_COMMAND_NAMES,
  });
  const parsed = parseDialect(dialect, { ...commands, mentions });
  const skills = parsed.skills;
  const skillCost = {
    count: skills.length,
    bytes: skills.reduce(
      (total, skill) =>
        total + (commands.skills.find((item) => item.name === skill.name)?.bytes ?? 0),
      0,
    ),
  };
  return {
    skillCost,
    payload: {
      text: parsed.text,
      contexts: parsed.contexts,
      attachments: parsed.attachments,
      ...(parsed.command ? { command: parsed.command } : {}),
      ...(skills.length > 0 ? { skills } : {}),
    },
    blocking: parsed.diagnostics.filter((item) => isBlockingDiagnostic(item.code)),
    warnings: parsed.diagnostics.filter((item) => !isBlockingDiagnostic(item.code)),
  };
};

/**
 * 诊断 → 界面文案。key 就是中文原文（见 AGENTS.md「语言规范」），插值走 i18next；
 * 每一条都写成字面量 key + 参数对象，i18n 的类型才接得住。
 */
export const diagnosticMessage = (t: TFunction, diagnostic: DialectDiagnostic): string => {
  switch (diagnostic.code) {
    case "command-unknown":
      return t("命令不存在：{{name}}", { name: diagnostic.name });
    case "skill-unknown":
      return t("技能不存在：{{name}}", { name: diagnostic.name });
    case "command-duplicated":
      return t("一条消息只能有一个命令");
    case "container-unclosed":
      return t("容器没有闭合：{{name}}", { name: diagnostic.name });
    case "container-nested":
      return t("容器里不能再写容器：{{name}}", { name: diagnostic.name });
    case "attachment-invalid":
      // 原文可能是一整段粘错的内容，提示里只带个头
      return t("附件引用无效：{{raw}}", { raw: diagnostic.raw.slice(0, 60) });
  }
};
