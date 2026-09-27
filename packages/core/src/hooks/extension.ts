import type {
  ExtensionAPI,
  ExtensionUIContext,
  ToolCallEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { hooksFileFor, loadHookRegistrations } from "./config.ts";
import { describeDecision } from "./output.ts";
import { runHooks } from "./runner.ts";
import type { HookEvent, HookInput, HookRegistration, MergedDecision } from "./types.ts";

/**
 * 钩子扩展（F-3.7）：把子进程钩子挂到基座的生命周期事件上。
 *
 * 事件映射（沿用 Claude Code 的词汇，便于 F-3.9 导入）：
 * | 钩子事件 | 基座事件 | 能做什么 |
 * |---|---|---|
 * | SessionStart | `session_start` | 记录/准备（不拦） |
 * | UserPromptSubmit | `input` | 拦下提示、或给提示追加上下文 |
 * | PreToolUse | `tool_call` | allow / ask / deny，或改写入参 |
 * | PostToolUse | `tool_result` | 给工具结果追加上下文 |
 * | Stop | `agent_settled` | 收尾副作用（不拦） |
 *
 * 决定语义：**拒绝一票否决**；`ask` 在有人承载时转成一次人类确认，无人时按策略拒绝（与工具闸门一致）。
 */

export type HooksExtensionOptions = {
  dataDir: string;
  cwd: string;
  sessionId: string;
  /** 无 UI 承载时 `ask` 的降级原因文案。 */
  noUiReason?: string;
  /** 决策审计（谁拦了什么）。 */
  onDecision?: (decision: {
    hook: string;
    event: HookEvent;
    approved: boolean;
    reason: string;
  }) => void;
};

export function createHooksExtension(options: HooksExtensionOptions): (pi: ExtensionAPI) => void {
  const hooksFile = hooksFileFor(options.dataDir);
  let registrations: HookRegistration[] = [];

  return (pi: ExtensionAPI): void => {
    // 工厂里读配置（不是起进程），会话开始再刷新一次，用户改完配置下次会话生效。
    pi.on("session_start", async (_event, ctx) => {
      registrations = (await loadHookRegistrations(hooksFile)).registrations;
      await fireAndForget("SessionStart", undefined, ctx);
    });

    pi.on("input", async (event, ctx) => {
      const merged = await run("UserPromptSubmit", event.text, () => ({
        event: "UserPromptSubmit",
        sessionId: options.sessionId,
        cwd: options.cwd,
        prompt: event.text,
      }));
      if (merged === null) return undefined;

      if (merged.decision === "deny") {
        options.onDecision?.({
          hook: "UserPromptSubmit",
          event: "UserPromptSubmit",
          approved: false,
          reason: describeDecision(merged) ?? "被钩子拦下",
        });
        notify(ctx, describeDecision(merged) ?? "本次输入被钩子拦下。");
        return { action: "handled" as const };
      }
      if (merged.additionalContext.length > 0) {
        return {
          action: "transform" as const,
          text: `${event.text}\n\n${merged.additionalContext.join("\n\n")}`,
        };
      }
      return undefined;
    });

    pi.on(
      "tool_call",
      async (
        event: ToolCallEvent,
        ctx,
      ): Promise<{ block?: boolean; reason?: string; terminate?: boolean } | undefined> => {
        const merged = await run("PreToolUse", event.toolName, () => ({
          event: "PreToolUse",
          sessionId: options.sessionId,
          cwd: options.cwd,
          toolName: event.toolName,
          toolInput: event.input as Record<string, unknown>,
        }));
        if (merged === null || merged.decision === null || merged.decision === "allow") {
          return undefined; // 无决定 / 放行：交回给工具闸门
        }

        if (merged.decision === "deny") {
          options.onDecision?.({
            hook: "PreToolUse",
            event: "PreToolUse",
            approved: false,
            reason: describeDecision(merged) ?? "被钩子拒绝",
          });
          return { block: true, reason: describeDecision(merged) ?? "该工具调用被钩子拒绝。" };
        }

        // ask：转成一次人类确认（与工具闸门同款三选一，但这里只有"允许/拒绝"）
        const ui = (ctx as { ui?: ExtensionUIContext }).ui;
        const hasUi = (ctx as { hasUI?: boolean }).hasUI === true;
        if (!hasUi || ui === undefined) {
          options.onDecision?.({
            hook: "PreToolUse",
            event: "PreToolUse",
            approved: false,
            reason: "hook-ask-no-ui",
          });
          return {
            block: true,
            reason:
              options.noUiReason ?? "钩子要求确认，但当前没有可承载交互的控制层，已按策略拒绝。",
          };
        }
        const question = `${describeDecision(merged) ?? "钩子要求确认"}：允许执行 ${event.toolName}？`;
        const choice = await ui.select(question, ["允许一次", "拒绝"]);
        const approved = choice === "允许一次";
        options.onDecision?.({
          hook: "PreToolUse",
          event: "PreToolUse",
          approved,
          reason: approved ? "hook-ask-approved" : "hook-ask-denied",
        });
        return approved ? undefined : { block: true, reason: "钩子确认未获批准。" };
      },
    );

    pi.on("tool_result", async (event: ToolResultEvent) => {
      const text = flattenContent(event.content);
      const merged = await run("PostToolUse", event.toolName, () => ({
        event: "PostToolUse",
        sessionId: options.sessionId,
        cwd: options.cwd,
        toolName: event.toolName,
        toolInput: event.input,
        toolResult: { text, isError: event.isError },
      }));
      if (merged === null || merged.additionalContext.length === 0) return undefined;
      return {
        content: [
          ...event.content,
          { type: "text" as const, text: `\n[钩子补充]\n${merged.additionalContext.join("\n\n")}` },
        ],
      };
    });

    pi.on("agent_settled", async (_event, ctx) => {
      await fireAndForget("Stop", undefined, ctx);
    });

    // ── 内部 ──

    async function run(
      event: HookEvent,
      subject: string | undefined,
      buildInput: () => HookInput,
    ): Promise<MergedDecision | null> {
      const matching = registrations.some((registration) => registration.event === event);
      if (!matching) return null;
      return runHooks(registrations, event, subject, buildInput);
    }

    async function fireAndForget(
      event: HookEvent,
      subject: string | undefined,
      ctx: unknown,
    ): Promise<void> {
      const merged = await run(event, subject, () => ({
        event,
        sessionId: options.sessionId,
        cwd: options.cwd,
      }));
      for (const result of merged?.runs ?? []) {
        if (result.error !== undefined) {
          notify(ctx, `钩子 ${event} 执行异常：${result.error}`);
        }
      }
    }
  };
}

function flattenContent(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function notify(ctx: unknown, message: string): void {
  const ui = (ctx as { ui?: ExtensionUIContext }).ui;
  ui?.notify(message, "warning");
}
