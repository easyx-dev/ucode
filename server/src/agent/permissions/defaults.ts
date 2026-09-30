/**
 * 默认权限规则：与 opencode 对齐的两条底线。
 *
 * - `.env` / `.env.*` 的读写默认阻断，`.env.example` 这类示例文件放行；
 * - 工作目录之外的路径默认走审批（`external_directory`）。
 *
 * 规则是「最后命中者胜」，所以放行 `.env.example` 的规则必须排在通配的阻断规则之后。
 */
import type { PermissionRule } from "./engine";

/** 会命中路径类规则的工具：env 文件对读与写都拦 */
const ENV_TOOLS = ["read", "write", "edit"] as const;

export const DEFAULT_PERMISSION_RULES: readonly PermissionRule[] = [
  ...ENV_TOOLS.flatMap((tool): PermissionRule[] => [
    { tool, pattern: "*.env", action: "deny", note: "环境变量文件通常含密钥" },
    { tool, pattern: "*.env.*", action: "deny", note: "环境变量文件通常含密钥" },
    { tool, pattern: "*.env.example", action: "allow", note: "示例文件不含真实密钥" },
  ]),
  { tool: "external_directory", pattern: "*", action: "ask", note: "工作目录之外的路径" },
];
