/**
 * 插件与组件的命名：显示名 `<plugin>:<name>`，底层 token `<plugin>-<name>`。
 *
 * token 会拼进工具名（`mcp__plugin_<token>_<server>__<tool>`）与提示词命令名，必须过 pi 的字符集；
 * 同名冲突追加内容哈希后缀而不报错——两个插件用了同一个组件名是常态，不该因此装不上。
 */
import { createHash } from "node:crypto";

import {
  PLUGIN_RESERVED_COMPONENT_TOKENS,
  PLUGIN_TOKEN_HASH_LENGTH,
  PLUGIN_TOKEN_PREFIX,
} from "../../constants/plugins";

/** 归一化成可用作 token 的串：小写、非字母数字转 `-`、折叠并去首尾 `-`；全被剔掉时返回空串 */
export const sanitizeToken = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

/** 内容哈希后缀：同一 token 被多处占用时区分，长度固定便于阅读 */
export const tokenHashSuffix = (input: string): string =>
  createHash("sha256").update(input).digest("hex").slice(0, PLUGIN_TOKEN_HASH_LENGTH);

/**
 * 插件 token：sanitize 后为空（全中文目录名等）或用数字开头时补前缀，
 * 保证结果始终能安全用作标识的一部分。
 */
export const toPluginToken = (name: string): string => {
  const token = sanitizeToken(name);
  if (!token) return `${PLUGIN_TOKEN_PREFIX}-${tokenHashSuffix(name)}`;
  return /^[0-9]/.test(token) ? `${PLUGIN_TOKEN_PREFIX}${token}` : token;
};

/** 组件名归一：sanitize 后为空时用原名哈希兜底，避免拼出 `plugin-` 这样的半截 token */
const componentNameToken = (name: string): string => sanitizeToken(name) || tokenHashSuffix(name);

/** 组件 token：`<plugin>-<component>`；与已占用集合或保留名冲突时追加哈希后缀 */
export const toComponentToken = (
  pluginName: string,
  componentName: string,
  taken: ReadonlySet<string> = new Set(),
): string => {
  const base = `${toPluginToken(pluginName)}-${componentNameToken(componentName)}`;
  const reserved = (PLUGIN_RESERVED_COMPONENT_TOKENS as readonly string[]).includes(base);
  return taken.has(base) || reserved ? `${base}-${tokenHashSuffix(base)}` : base;
};

/** 显示名：`<plugin>:<component>`，只用于界面与 `/` 菜单，不进底层标识 */
export const toComponentLabel = (pluginName: string, componentName: string): string =>
  `${pluginName}:${componentName}`;
