/**
 * 模型适配口子：按模型解析提示词变体。
 *
 * opencode 按模型族选整份提示词文件（anthropic / gpt / gemini / kimi …）；我们先统一用
 * `default`，需要模型族差异时在这里按 `modelRef` 返回对应变体，并在各语言目录的
 * `variantNotes` 里补该族的追加文案。
 */
import { DEFAULT_PROMPT_VARIANT, type PromptVariant } from "./types";

export const resolvePromptVariant = (_modelRef: string | null): PromptVariant =>
  DEFAULT_PROMPT_VARIANT;
