/**
 * 系统提示词组装：把语言目录 + 当前模式 + 模型族变体拼成整段提示词（或 pi 源的叠加片段）。
 *
 * 提示词由 `APP_PROMPT_SOURCE` 选择（默认 `custom`）：
 * - `custom`（默认）：整段替换 pi 默认前缀与 tools / rules / docs 三节（`systemPromptOverride`）。
 *   正文以 opencode 的提示词分节与规则为蓝本移植改写：去掉 CLI / 终端语境与 opencode 专有入口
 *   （帮助链接、Task 子智能体、TodoWrite 等我们没有的能力），工具名对齐本仓库（`find` 而非 `glob`），
 *   把 opencode 的「禁止写注释」换成「遵循项目 AGENTS.md」，并按当前模式裁剪工具使用指引。
 *   正文按语言存放在 `prompt/locales`（多语言口子），按模型族在 `prompt/variant.ts` 解析变体。
 * - `pi`：保留 pi 默认提示词，只追加身份、模式约束、外部内容边界，供 `pnpm eval` 按源对比。
 *
 * pi 仍会追加 `<skills>` / `<project_context>` / `<cwd>`。两套源的取舍由真实模型评测决定（见 `server/scripts/eval.ts`）。
 */
import { brand } from "@ucode/brand/values";
import { MEMORY_TOOL_NAMES } from "../../features/memory/tools";
import { type AgentProfile, primaryToolNames, type SubagentSlug } from "../agents";
import { WRITE_TOOLS } from "../tools/names";
import { catalogFor, type PromptLocale } from "./locales";
import { DEFAULT_PROMPT_VARIANT, type PromptCatalog, type PromptVariant } from "./types";

export type PromptBuildInput = {
  mode: string;
  /** 角色提示词约束正文；缺省按 mode 取语言目录。子角色与自定义角色显式传入 */
  agentSection?: string;
  /** 本次会话可用工具名；缺省取该模式的实际工具集。用来生成「工具使用」分节 */
  tools?: readonly string[];
  /** 语言（多语言口子，默认中文目录；见 `prompt/locales`） */
  locale?: PromptLocale;
  /** 模型族变体（模型适配口子，默认 default；见 `prompt/variant.ts`） */
  variant?: PromptVariant;
  /** 项目记忆是否开启：决定记忆分节与 remember / forget 工具指引是否拼入 */
  memoryEnabled?: boolean;
};

/** 当前可用工具名：优先用显式传入的（已与父能力取交集），否则按模式解析 */
const promptToolNames = (input: PromptBuildInput): string[] => {
  const base = input.tools ? [...input.tools] : primaryToolNames(input.mode);
  return [
    ...base,
    ...(input.memoryEnabled && input.mode === "build" ? [...MEMORY_TOOL_NAMES] : []),
  ];
};

/**
 * 本次工具表里真正会写盘 / 执行命令的工具：只读模式的约束文案要列举它们。
 * 不直接用 `WRITE_TOOLS`：那份清单按平台不同（Windows 上另有 powershell），文案列举必须跟着工具表走，
 * 否则会提到本次会话根本没有的工具。
 */
const blockedToolsOf = (tools: readonly string[]): string[] =>
  WRITE_TOOLS.filter((name) => tools.includes(name));

const resolvedSection = (catalog: PromptCatalog, input: PromptBuildInput): string =>
  input.agentSection ??
  (catalog.modeConstraints(blockedToolsOf(promptToolNames(input))) as Record<string, string>)[
    input.mode
  ] ??
  "";

const modeBlock = (catalog: PromptCatalog, section: string): string =>
  `${catalog.modeHeading}\n${section}`;

/** 把一份目录拼成整段提示词；目录与拼装分开，便于单测模型变体等口子 */
export const composeFullPrompt = (
  catalog: PromptCatalog,
  brandName: string,
  input: PromptBuildInput,
): string => {
  const variant = input.variant ?? DEFAULT_PROMPT_VARIANT;
  const parts = [
    catalog.identity(brandName),
    catalog.tone,
    catalog.objectivity,
    catalog.proactiveness,
    catalog.conventions,
    catalog.codeStyle,
    catalog.doingTasks,
    catalog.toolPolicy(promptToolNames(input)),
    catalog.codeReferences,
  ];
  const note = catalog.variantNotes[variant];
  if (note) parts.push(note);
  if (input.memoryEnabled) parts.push(catalog.memory);
  parts.push(modeBlock(catalog, resolvedSection(catalog, input)), catalog.untrusted);
  return parts.join("\n\n");
};

/** pi 源：只留身份、模型变体追加、模式约束与外部内容边界，其余仍由 pi 生成 */
export const composeOverlayPrompt = (
  catalog: PromptCatalog,
  brandName: string,
  input: PromptBuildInput,
): string => {
  const variant = input.variant ?? DEFAULT_PROMPT_VARIANT;
  const parts = [catalog.overlayIdentity(brandName)];
  const note = catalog.variantNotes[variant];
  if (note) parts.push(note);
  if (input.memoryEnabled) parts.push(catalog.memory);
  parts.push(modeBlock(catalog, resolvedSection(catalog, input)), catalog.untrusted);
  return parts.join("\n\n");
};

export const buildFullPrompt = (input: PromptBuildInput): string =>
  composeFullPrompt(catalogFor(input.locale), brand.name, input);

export const buildPromptOverlay = (input: PromptBuildInput): string =>
  composeOverlayPrompt(catalogFor(input.locale), brand.name, input);

/** 解析角色的提示词约束正文：自定义角色用自己的正文，内置角色取语言目录 */
export const promptSectionOf = (
  profile: AgentProfile,
  tools: readonly string[] = primaryToolNames(profile.slug),
  locale?: PromptLocale,
): string => {
  if (profile.promptSection) return profile.promptSection;
  const catalog = catalogFor(locale);
  return profile.kind === "primary"
    ? ((catalog.modeConstraints(blockedToolsOf(tools)) as Record<string, string>)[profile.slug] ??
        "")
    : (catalog.subagentConstraints[profile.slug as SubagentSlug] ?? "");
};

export { resolvePromptVariant } from "./variant";
export type { PromptVariant, SubagentSlug };
