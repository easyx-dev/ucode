/**
 * 只读命令判定：给定一条 shell 命令，判断它是否**不改动任何东西**。
 *
 * 用途是 `plan` 自主级别（只读模式）下放行安全命令——否则连 `git status`、`cat` 都被拦，
 * 计划模式就没法调研了。判定是"白名单命中 **且** 危险词表未命中"。
 *
 * 词表照搬基座官方示例 `examples/extensions/plan-mode/utils.ts`（DESTRUCTIVE_PATTERNS /
 * SAFE_PATTERNS）：它是成熟清单，自己再写一份只会更差。
 *
 * **这不是安全边界**：正则匹配挡不住 `$(...)`、反引号、别名之类的组合把戏。
 * 真正的边界是工具闸门（`tool-gate.ts`）——它在 `tool_call` 上拦，与命令内容无关。
 * 这里只负责"计划模式下别把只读调研也堵死"，因此宁可保守：认不出的一律不放行。
 */

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
  /^\s*yarn\s+(list|info|why|audit)/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*curl\s/i,
  /^\s*wget\s+-O\s*-/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
];

/** 是否是一条只读命令（危险词表未命中且白名单命中）。 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === "") return false;
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return SAFE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** 会执行 shell 命令的工具名（`plan` 档下走上面的白名单判定，而不是一律拦）。 */
export const COMMAND_TOOLS = new Set(["bash", "shell", "exec", "run"]);

export function isCommandTool(toolName: string): boolean {
  return COMMAND_TOOLS.has(toolName.toLowerCase());
}
