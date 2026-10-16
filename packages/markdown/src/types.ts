/**
 * 方言的数据模型：解析产物（载荷 + 诊断）与渲染所需的输入。
 *
 * 载荷与今天的接口契约同口径：`text` / `args` 是**标记形态**（`@路径`、`图片 N`、`附件 N.ext`），
 * 行范围与附件 id 走 `contexts` / `attachments`——服务端因此完全不需要知道方言。
 */
import type { AttachmentRef, ContextRef } from "@ucode/contracts";

/** 附件在 scheme 里的类型标记：由 mimeType 派生，只影响 scheme 字面与展示层图标 */
export const DIALECT_ATTACHMENT_KINDS = [
  "image",
  "pdf",
  "text",
  "doc",
  "sheet",
  "slide",
  "archive",
  "audio",
  "video",
  "binary",
] as const;

export type DialectAttachmentKind = (typeof DIALECT_ATTACHMENT_KINDS)[number];

/** 一条命令：名字 + 参数（参数是标记形态的正文，模板占位按它替换） */
export type DialectCommand = { name: string; args: string };

/** 一次技能调用：名字 + 该技能自己的参数 */
export type DialectSkill = { name: string; args: string };

/** 渲染方言要知道附件的类型与显示名；解析不需要——scheme 里已经带了这两样 */
export type DialectAttachmentView = {
  id: string;
  kind: DialectAttachmentKind;
  /** 显示名，省略时渲染成不带 label 的图片语法 */
  name: string | null;
};

/**
 * 诊断只给码与参数，文案由界面按码渲染（与接口错误码同一套约定）；`offset` 指向方言原文，
 * 供编辑器高亮用。
 */
export type DialectDiagnostic =
  | { code: "command-unknown"; name: string; offset: number }
  | { code: "skill-unknown"; name: string; offset: number }
  | { code: "command-duplicated"; name: string; offset: number }
  | { code: "container-unclosed"; name: string; offset: number }
  | { code: "container-nested"; name: string; offset: number }
  | { code: "attachment-invalid"; raw: string; offset: number };

/** 阻断发送的诊断码：界面据此拦住提交，其余只提示 */
const BLOCKING_CODES = new Set<DialectDiagnostic["code"]>([
  "command-unknown",
  "skill-unknown",
  "command-duplicated",
  "container-unclosed",
  "container-nested",
]);

export const isBlockingDiagnostic = (code: DialectDiagnostic["code"]): boolean =>
  BLOCKING_CODES.has(code);

export type DialectDocument = {
  /** 命令最多一条（主指令） */
  command?: DialectCommand;
  /** 技能可多条，顺序即注入顺序；每条带自己的参数 */
  skills: DialectSkill[];
  /** 容器外的用户正文（标记形态） */
  text: string;
  contexts: ContextRef[];
  attachments: AttachmentRef[];
  diagnostics: DialectDiagnostic[];
};

/** 定形与校验要用的清单：名字来源与 `/` 菜单一致（`commands/list`） */
export type InvocationCandidates = {
  prompts: readonly { name: string }[];
  skills: readonly { name: string }[];
};
