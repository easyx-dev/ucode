/**
 * 插件变量解析：`${…_PLUGIN_ROOT}` / `${…_PLUGIN_DATA}` / `${…_PROJECT_DIR}` 与 `${user_config.KEY}`。
 *
 * 变量名一律由品牌派生（`CLAUDE_*` / `ZCODE_*` 是别名）。两条边界来自 `plans/plugins.md` 3.4：
 * - **shell 形式的 hook `command` 与 MCP `headersHelper` 里禁止 `${user_config.*}`**：值会被 shell 再解析一遍，
 *   等于把注入面交给用户输入；这类字段上遇到就丢弃并出诊断。
 * - 解析不了的名字原样保留并出诊断：静默替换成空串会让插件「看起来在跑」。
 */
import { mkdirSync } from "node:fs";

import { brand } from "@ucode/brand/values";

/** 本品牌的变量前缀：`<SLUG>_PLUGIN_ROOT` 这类 */
export const PLUGIN_VARIABLE_PREFIX = brand.slug.toUpperCase();

/** 兼容别名：Claude 与 ZCode 写法的变量名 */
const COMPAT_PREFIXES = ["CLAUDE", "ZCODE"];

const PREFIXES = [PLUGIN_VARIABLE_PREFIX, ...COMPAT_PREFIXES];

export type PluginVariableContext = {
  /** 插件安装目录（`${*_PLUGIN_ROOT}`） */
  pluginRoot: string;
  /** 插件持久数据目录（`${*_PLUGIN_DATA}`）；解析时会创建 */
  pluginDataDir: string;
  /** 会话工作目录（`${*_PROJECT_DIR}`）；配置解析等没有会话上下文时缺省 */
  projectDir?: string;
  /** `userConfig` 的已存值 */
  config: Record<string, string | number | boolean>;
  /** 是否允许 `${user_config.*}`；shell 字段上必须为 false */
  allowUserConfig: boolean;
};

export type PluginVariableResult = {
  text: string;
  /** 解析不了 / 被拒绝的变量说明 */
  diagnostics: string[];
};

/** 变量匹配：`${…}` 里是「前缀_后缀」或 `user_config.KEY` */
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)?)\}/g;

/** `${…_PLUGIN_DATA}` 解析时按需建目录：插件第一次引用就应当写进去 */
export const ensurePluginDataDir = (dir: string): void => {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // 建不出来只影响插件自己写数据，解析照常给路径
  }
};

const resolveBuiltin = (name: string, ctx: PluginVariableContext): string | null | undefined => {
  for (const prefix of PREFIXES) {
    if (name === `${prefix}_PLUGIN_ROOT`) return ctx.pluginRoot;
    if (name === `${prefix}_PLUGIN_DATA`) {
      ensurePluginDataDir(ctx.pluginDataDir);
      return ctx.pluginDataDir;
    }
    if (name === `${prefix}_PROJECT_DIR`) return ctx.projectDir ?? null;
  }
  return undefined;
};

export const resolvePluginVariables = (
  text: string,
  ctx: PluginVariableContext,
): PluginVariableResult => {
  if (!text.includes("${")) return { text, diagnostics: [] };

  const diagnostics: string[] = [];
  const resolved = text.replace(VARIABLE, (match, name: string) => {
    if (name.startsWith("user_config.")) {
      if (!ctx.allowUserConfig) {
        diagnostics.push(
          `${match}：shell 字段里不能引用 user_config（值会被 shell 再解析），已丢弃`,
        );
        return "";
      }
      const key = name.slice("user_config.".length);
      const value = ctx.config[key];
      if (value === undefined) {
        diagnostics.push(`${match}：userConfig 里没有 ${key}（用户还没填），已留空`);
        return "";
      }
      return String(value);
    }

    const builtin = resolveBuiltin(name, ctx);
    if (builtin === undefined) {
      diagnostics.push(`${match}：不是已知的插件变量，已原样保留`);
      return match;
    }
    if (builtin === null) {
      diagnostics.push(`${match}：当前上下文没有工作目录（只在会话里可用），已留空`);
      return "";
    }
    return builtin;
  });

  return { text: resolved, diagnostics };
};

/** 解析一组字符串字段（命令行 / 参数 / 环境变量值），把诊断合并成一份 */
export const resolvePluginVariablesIn = (
  values: readonly string[],
  ctx: PluginVariableContext,
): { values: string[]; diagnostics: string[] } => {
  const diagnostics: string[] = [];
  const resolved = values.map((value) => {
    const result = resolvePluginVariables(value, ctx);
    diagnostics.push(...result.diagnostics);
    return result.text;
  });
  return { values: resolved, diagnostics };
};
