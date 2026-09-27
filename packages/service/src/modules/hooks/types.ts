/**
 * 生命周期钩子（F-3.7）：类型与常量。
 *
 * 钩子是**配置化的子进程**——数据层 `hooks.json` 里声明，服务层在生命周期节点上 spawn 它、
 * 用 stdin 递一行 JSON、读 stdout 的一行 JSON 作决定。之所以用子进程而不是进程内回调：
 * 钩子来自用户配置、可以任意语言实现、崩溃不能拖垮服务层（V-9 已证协议可行）。
 *
 * 事件名沿用 Claude Code 的既有约定（`PreToolUse` 等），是为了让 F-3.9「从外部 Agent 导入」
 * 有共同词汇——导入时不必做事件名的翻译。
 */

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === "string" && (HOOK_EVENTS as readonly string[]).includes(value);
}

/** 一条钩子注册：事件 + 匹配器 + 要跑的命令。 */
export type HookRegistration = {
  event: HookEvent;
  /**
   * 匹配器（只对有"主体"的事件有意义）：
   * - 省略或 `*`：全部匹配；
   * - `a|b|c`：精确名列表（工具名 / 提示词关键词）；
   * - `/正则/`：正则。
   * PreToolUse/PostToolUse 的主体是工具名；UserPromptSubmit 的主体是提示词文本。
   */
  matcher?: string;
  /** shell 命令（经 `sh -c` 执行，因此可含管道与参数）或 argv 数组（不经 shell）。 */
  command: string | string[];
  /** 超时（毫秒），默认 10s。超时按"无决定"处置，并记一条告警。 */
  timeoutMs?: number;
  /** 仅用于日志与诊断的说明。 */
  description?: string;
};

/** 钩子对外的决定（输出 JSON 的形状）。 */
export type HookDecision = "allow" | "ask" | "deny";

export type HookOutput = {
  decision?: HookDecision;
  /** 决定原因，会透传给模型/用户。 */
  reason?: string;
  /** 追加进上下文的文本（PostToolUse / UserPromptSubmit 生效）。 */
  additionalContext?: string;
  /** 置 false 表示"阻止继续"（PreToolUse 等价 deny；UserPromptSubmit 等价拦下该提示）。 */
  continue?: boolean;
};

/** 递进钩子子进程 stdin 的载荷。 */
export type HookInput = {
  event: HookEvent;
  sessionId: string;
  cwd: string;
  /** PreToolUse / PostToolUse。 */
  toolName?: string;
  toolInput?: Record<string, unknown>;
  /** PostToolUse：工具结果的文本（已压平，避免钩子处理复杂的多模态结构）。 */
  toolResult?: { text: string; isError: boolean };
  /** UserPromptSubmit。 */
  prompt?: string;
};

/** 一次钩子执行的结果（含元信息，便于审计与诊断）。 */
export type HookRunResult = {
  registration: HookRegistration;
  output: HookOutput | null;
  /** 执行层面的问题（超时/非零退出/JSON 非法），不影响 output 为 null。 */
  error?: string;
  durationMs: number;
};

/** 合并后的决定：deny 胜 ask，ask 胜 allow；无任何决定时为 null。 */
export type MergedDecision = {
  decision: HookDecision | null;
  reasons: string[];
  additionalContext: string[];
  /** 是否有钩子显式要求"不继续"。 */
  stop: boolean;
  runs: HookRunResult[];
};
