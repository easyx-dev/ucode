/**
 * 提示词语言注册表：新增语言＝按 `PromptCatalog` 加一份目录文件并在此登记。
 *
 * 语言与界面 locale 解耦：提示词语言可以晚于界面语言，`PromptLocale` 由本表推导。
 */
import type { PromptCatalog } from "../types";
import { zhCN } from "./zh-CN";

export const PROMPT_LOCALES = ["zh-CN"] as const;

export type PromptLocale = (typeof PROMPT_LOCALES)[number];

export const DEFAULT_PROMPT_LOCALE: PromptLocale = "zh-CN";

const CATALOGS: Record<PromptLocale, PromptCatalog> = { "zh-CN": zhCN };

export const catalogFor = (locale: PromptLocale = DEFAULT_PROMPT_LOCALE): PromptCatalog =>
  CATALOGS[locale];
