/**
 * 默认权限规则：与 opencode 对齐的两条底线。
 *
 * - `.env` / `.env.*` 的读写默认阻断，`.env.example` 这类示例文件放行；
 * - 工作目录之外的路径默认走审批（`external_directory`）。
 *
 * 规则是「最后命中者胜」，所以放行 `.env.example` 的规则必须排在通配的阻断规则之后。
 */

import { toPosixPath } from "../../../platform/paths";
import type { PermissionRule } from "./engine";

/** 会命中路径类规则的工具：env 文件对读与写都拦 */
const ENV_TOOLS = ["read", "write", "edit"] as const;

export const DEFAULT_PERMISSION_RULES: readonly PermissionRule[] = [
  ...ENV_TOOLS.flatMap((tool): PermissionRule[] => [
    { tool, pattern: "*.env", action: "deny", note: "环境变量文件通常含密钥" },
    { tool, pattern: "*.env.*", action: "deny", note: "环境变量文件通常含密钥" },
    { tool, pattern: "*.env.example", action: "allow", note: "示例文件不含真实密钥" },
  ]),
  // 打开外部页面要经过一次确认：匹配对象是目标站点（`toolTarget` 取 host），用户能对某个站点
  // 「本会话恒允」；其余 browser_* 作用于已批准的页面，不重复审批。
  { tool: "browser_open", pattern: "*", action: "ask", note: "打开外部页面" },
  { tool: "external_directory", pattern: "*", action: "ask", note: "工作目录之外的路径" },
];

/**
 * 技能目录属于可读资源：模型按技能说明读 `SKILL.md` 及其相对引用文件时，
 * 目标通常在会话工作目录之外（全局 / 用户 / 项目祖先链），不该被 `external_directory` 拦。
 * 规则只覆盖给定目录整棵子树，且排在模式规则之后——只读模式对 write / edit 的阻断更严，仍会生效。
 */
export const skillDirectoryRules = (dirs: readonly string[]): PermissionRule[] =>
  dirs.map((dir) => ({
    tool: "external_directory",
    pattern: `${toPosixPath(dir)}/**`,
    action: "allow",
    note: "技能目录属于可读资源",
  }));
