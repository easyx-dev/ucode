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
import type { SessionMode } from "@ucode/contracts";

import { toolsForMode } from "../modes";
import { catalogFor, type PromptLocale } from "./locales";
import { DEFAULT_PROMPT_VARIANT, type PromptCatalog, type PromptVariant } from "./types";

export type PromptBuildInput = {
  mode: SessionMode;
  /** 语言（多语言口子，默认中文目录；见 `prompt/locales`） */
  locale?: PromptLocale;
  /** 模型族变体（模型适配口子，默认 default；见 `prompt/variant.ts`） */
  variant?: PromptVariant;
};

const modeBlock = (catalog: PromptCatalog, mode: SessionMode): string =>
  `${catalog.modeHeading}\n${catalog.modeConstraints[mode]}`;

/** 把一份目录拼成整段提示词；目录与拼装分开，便于单测模型变体等口子 */
export const composeFullPrompt = (
  catalog: PromptCatalog,
  brandName: string,
  mode: SessionMode,
  variant: PromptVariant,
): string => {
  const parts = [
    catalog.identity(brandName),
    catalog.tone,
    catalog.objectivity,
    catalog.proactiveness,
    catalog.conventions,
    catalog.codeStyle,
    catalog.doingTasks,
    catalog.toolPolicy(toolsForMode(mode)),
    catalog.codeReferences,
  ];
  const note = catalog.variantNotes[variant];
  if (note) parts.push(note);
  parts.push(modeBlock(catalog, mode), catalog.untrusted);
  return parts.join("\n\n");
};

/** pi 源：只留身份、模型变体追加、模式约束与外部内容边界，其余仍由 pi 生成 */
export const composeOverlayPrompt = (
  catalog: PromptCatalog,
  brandName: string,
  mode: SessionMode,
  variant: PromptVariant,
): string => {
  const parts = [catalog.overlayIdentity(brandName)];
  const note = catalog.variantNotes[variant];
  if (note) parts.push(note);
  parts.push(modeBlock(catalog, mode), catalog.untrusted);
  return parts.join("\n\n");
};

export const buildFullPrompt = (input: PromptBuildInput): string =>
  composeFullPrompt(
    catalogFor(input.locale),
    brand.name,
    input.mode,
    input.variant ?? DEFAULT_PROMPT_VARIANT,
  );

export const buildPromptOverlay = (input: PromptBuildInput): string =>
  composeOverlayPrompt(
    catalogFor(input.locale),
    brand.name,
    input.mode,
    input.variant ?? DEFAULT_PROMPT_VARIANT,
  );

export type { PromptVariant } from "./types";
export { resolvePromptVariant } from "./variant";
