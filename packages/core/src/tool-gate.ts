import type {
  ExtensionAPI,
  ExtensionUIContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutonomyLevel } from "@ucode/protocol";

/**
 * 工具调用闸门：自主级别门槛与人类批准（spec §2.5 / §4.6）。
 *
 * 这是"批准确认"真正落地的地方：基座没有内建的权限管理器（已核实），
 * 批准动作由 `tool_call` 处理器发起——它可以是 async，也可以返回 block。
 *
 * 四档自主级别（F-1.9）在这里的行为：
 * - `plan`：只读，改动类工具一律拦下；
 * - `confirm`（默认）：改动类工具请求人类批准；无人可承载则**不放行**（把"没有人在看"当成"用户同意"等于无人值守自动提权）；
 * - `auto-edit` / `full-access`：免批准，但**能驱动它的通路受门槛限制**（由核心层在命令面前置校验）。
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

export function isMutatingTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  if (MUTATING_TOOLS.has(normalized)) return true;
  return !/^(read|read_file|grep|find|glob|ls|list|list_dir|search|web_search|webfetch|fetch|todo|task)/.test(
    normalized,
  );
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

        if (level === "plan" && mutating) {
          options.onDecision?.({ toolName: event.toolName, approved: false, reason: "plan-mode" });
          return { block: true, reason: "计划模式：不执行改动类工具。" };
        }

        if (!mutating || level === "auto-edit" || level === "full-access") {
          options.onDecision?.({ toolName: event.toolName, approved: true, reason: level });
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

        const approved = await ui.confirm(
          `允许执行 ${event.toolName}？`,
          summarizeToolInput(event.input ?? {}),
        );
        options.onDecision?.({
          toolName: event.toolName,
          approved,
          reason: approved ? "user-approved" : "user-denied",
        });
        return approved ? {} : { block: true, reason: "用户未批准该操作。" };
      },
    );
  };
}
