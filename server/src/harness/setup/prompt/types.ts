/**
 * 系统提示词的类型与常量：语言目录（`PromptCatalog`）与模型族变体（`PromptVariant`）。
 *
 * 两个口子都在这里定型：新增语言＝按 `PromptCatalog` 实现一份目录文件并在 `locales/index.ts` 注册；
 * 新增模型族差异＝扩 `PROMPT_VARIANTS` 并在 `variant.ts` 里按模型解析。
 */
import type { SessionMode } from "@ucode/contracts";

import type { SubagentSlug } from "../agents";

/**
 * 模型族变体：同一语言下针对模型族的差异文案。
 * opencode 用的是整份分模型提示词文件；我们先用「同一套正文 + 变体追加」，够用再升级。
 */
export const PROMPT_VARIANTS = ["default"] as const;

export type PromptVariant = (typeof PROMPT_VARIANTS)[number];

export const DEFAULT_PROMPT_VARIANT: PromptVariant = "default";

/**
 * 一份语言目录：所有分节文案（含 `## 标题`）都在这里，翻译时标题与正文一起改。
 * 字段即分节，拼装顺序由 `prompt/index.ts` 决定。
 */
export type PromptCatalog = {
  /** 整段自研提示词的身份句 */
  identity: (brandName: string) => string;
  /** pi 源追加的身份句（pi 默认前缀已有身份，只做产品归属与语言口径） */
  overlayIdentity: (brandName: string) => string;
  tone: string;
  objectivity: string;
  proactiveness: string;
  conventions: string;
  codeStyle: string;
  doingTasks: string;
  /** 工具使用分节：条目与可用工具强相关，由目录按当前工具生成 */
  toolPolicy: (tools: string[]) => string;
  codeReferences: string;
  /** 当前模式分节的标题 */
  modeHeading: string;
  /** 各主会话模式的约束文案；入参是本次会话会写盘 / 执行命令的工具名，只读模式要按它列举 */
  modeConstraints: (blockedTools: readonly string[]) => Record<SessionMode, string>;
  /** 各子角色的约束文案，键为子角色 slug */
  subagentConstraints: Record<SubagentSlug, string>;
  /** 项目记忆分节：仅在记忆开启时拼入 */
  memory: string;
  /** 外部内容边界分节 */
  untrusted: string;
  /** 模型族追加文案，缺省为空 */
  variantNotes: Partial<Record<PromptVariant, string>>;
};
