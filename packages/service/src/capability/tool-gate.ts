import type {
  ExtensionAPI,
  ExtensionUIContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutonomyLevel } from "@ucode/protocol";
import { isCommandTool, isReadOnlyCommand } from "./read-only-command.ts";

/**
 * 工具调用闸门：自主级别门槛与人类批准（spec §2.5 / §4.6）。
 *
 * 这是"批准确认"真正落地的地方：基座没有内建的权限管理器（已核实），
 * 批准动作由 `tool_call` 处理器发起——它可以是 async，也可以返回 block。
 *
 * 四档自主级别（F-1.9）在这里的行为：
 * - `plan`：只读。改动类工具一律拦下，但**只读命令**（`git status` / `cat` / `rg` …）放行——
 *   否则计划模式连调研都做不了；命令判定见 `read-only-command.ts`；
 * - `confirm`（默认）：改动类工具请求人类批准；无人可承载则**不放行**（把"没有人在看"当成"用户同意"等于无人值守自动提权）；
 * - `auto-edit` / `full-access`：免批准，但**能驱动它的通路受门槛限制**（由服务层在命令面前置校验）。
 */

/** 改动类工具：需要批准的那一类。未知工具按"改动类"处理（宁可多问一句）。 */
const MUTATING_TOOLS = new Set([
  "write",
  "write_file",
  "edit",
  "edit_file",
  "multiedit",
  "multi_edit",
  "apply_patch",
  "patch",
  "bash",
  "shell",
  "exec",
  "run",
  "notebook_edit",
  "notebookedit",
]);

/**
 * 不受批准门槛约束的额外工具：它们的作用域被自身实现限制在安全目录内（`memory` 只能写
 * 数据层的记忆目录），因此"改动类"的判断在这里不成立。
 *
 * `question` 是纯的人类交互（问一句、等回答，什么都不写）：对它要批准会连着打断两次——
 * 先弹"允许执行 question？"，批准之后才是真正的问题（实测截图确认）。名字也不匹配下面
 * 那条只读前缀正则，所以必须显式登记。
 */
const NON_MUTATING_TOOLS = new Set(["memory", "subagent", "goal", "wiki", "question"]);

export function isMutatingTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  if (NON_MUTATING_TOOLS.has(normalized)) return false;
  if (MUTATING_TOOLS.has(normalized)) return true;
  return !/^(read|read_file|grep|find|glob|ls|list|list_dir|search|web_search|webfetch|fetch|todo|task)/.test(
    normalized,
  );
}

/**
 * `plan` 档下这个调用放不放行。
 *
 * 与"结构性只读"（`SessionRuntime` 把改动类工具从工具集里摘掉）是**两道**：
 * 结构性那道让模型根本看不到 `write`/`edit`；这一道兜住命令类工具与第三方注册的工具。
 * 两道都在，是因为任何一道都可能被绕过——工具集可能被扩展改回来，命令判定只是正则。
 */
export function planModeAllows(
  toolName: string,
  input: Record<string, unknown>,
): { allowed: boolean; reason: string } {
  if (!isMutatingTool(toolName)) return { allowed: true, reason: "plan-read" };
  if (!isCommandTool(toolName)) return { allowed: false, reason: "plan-mutating" };
  const command = typeof input.command === "string" ? input.command : "";
  if (command === "") return { allowed: false, reason: "plan-mutating" };
  return isReadOnlyCommand(command)
    ? { allowed: true, reason: "plan-read-only-command" }
    : { allowed: false, reason: "plan-mutating" };
}

/**
 * `plan` 档下应该保留哪些工具（**结构性只读**：不在列表里的工具根本不会进模型上下文）。
 *
 * 命令类工具留着，由闸门按只读白名单逐条判定——否则计划模式连 `git status` 都做不了。
 * 这条与 `planModeAllows` 是两道：这道让模型看不到改动类工具，那道兜住命令与第三方工具。
 */
export function planModeToolNames(allToolNames: readonly string[]): string[] {
  return allToolNames.filter((name) => !isMutatingTool(name) || isCommandTool(name));
}

/** 把工具入参压成一行可读摘要（弹窗里显示给人看）。 */
export function summarizeToolInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return "(无参数)";
  const parts: string[] = [];
  for (const [key, value] of entries.slice(0, 4)) {
    const text =
      typeof value === "string" ? value : value === undefined ? "" : (JSON.stringify(value) ?? "");
    parts.push(`${key}: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`);
  }
  return parts.join("\n");
}

export type ToolGateOptions = {
  /** 当前会话的自主级别（可变：命令面可以改）。 */
  autonomy: () => AutonomyLevel;
  /** 决策记忆（F-1.10）：本会话内被"总是允许"的工具。由会话运行时持有。 */
  sessionAllowed: Set<string>;
  /** 无 UI 承载时的拒绝原因文案。 */
  noUiReason?: string;
  /** 决策审计（谁批了什么，spec §6.7 预留字段）。 */
  onDecision?: (decision: { toolName: string; approved: boolean; reason: string }) => void;
};

export function createToolGateExtension(options: ToolGateOptions): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    pi.on(
      "tool_call",
      async (event: ToolCallEvent, ctx): Promise<{ block?: boolean; reason?: string }> => {
        const level = options.autonomy();
        const mutating = isMutatingTool(event.toolName);

        if (level === "plan") {
          const input = (event.input ?? {}) as Record<string, unknown>;
          const verdict = planModeAllows(event.toolName, input);
          options.onDecision?.({
            toolName: event.toolName,
            approved: verdict.allowed,
            reason: verdict.reason,
          });
          return verdict.allowed
            ? {}
            : { block: true, reason: "计划模式：只放行只读操作，改动类工具与写命令都不执行。" };
        }

        if (!mutating || level === "auto-edit" || level === "full-access") {
          options.onDecision?.({ toolName: event.toolName, approved: true, reason: level });
          return {};
        }

        // 决策记忆（F-1.10）：用户选过"本会话内总是允许"就不再问。
        // 少了这一步，用户每次都会被同一件事再问一遍——选择形同虚设。
        if (options.sessionAllowed.has(event.toolName.toLowerCase())) {
          options.onDecision?.({
            toolName: event.toolName,
            approved: true,
            reason: "session-allowed",
          });
          return {};
        }

        // confirm：请求人类批准
        const ui = (ctx as { ui?: ExtensionUIContext }).ui;
        const hasUi = (ctx as { hasUI?: boolean }).hasUI === true;
        if (!hasUi || ui === undefined) {
          options.onDecision?.({ toolName: event.toolName, approved: false, reason: "no-ui" });
          return {
            block: true,
            reason:
              options.noUiReason ?? "当前没有可承载交互的控制层，已按策略拒绝（无人应答不放行）。",
          };
        }

        // 三选一（ZCode 同款）：允许一次 / 本会话内总是允许 / 拒绝。
        // 用 select 而不是 confirm，是为了让"决策记忆"成为用户显式的选择。
        const choice = await ui.select(`允许执行 ${event.toolName}？`, [
          "允许一次",
          "本会话内总是允许",
          "拒绝",
        ]);
        const approved = choice === "允许一次" || choice === "本会话内总是允许";
        if (choice === "本会话内总是允许") {
          options.sessionAllowed.add(event.toolName.toLowerCase());
        }
        options.onDecision?.({
          toolName: event.toolName,
          approved,
          reason: approved ? `user-approved:${choice}` : "user-denied",
        });
        return approved ? {} : { block: true, reason: "用户未批准该操作。" };
      },
    );
  };
}
