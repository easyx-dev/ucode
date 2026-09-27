import type { HookDecision, HookOutput, HookRunResult, MergedDecision } from "./types.ts";

/**
 * 钩子输出的解析与合并（F-3.7）。
 *
 * 一个事件可以匹配多条钩子，它们**顺序执行、结果合并**：
 * - 决定取最强：`deny` > `ask` > `allow`（拒绝一票否决）；
 * - 原因与追加上下文全部保留（诊断时能看到是谁拦的、谁补了什么）；
 * - `continue:false` 记录为 `stop`。
 */

export function matchesHookMatcher(
  matcher: string | undefined,
  subject: string | undefined,
): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (subject === undefined) return true; // 无主体的事件（SessionStart/Stop）不按匹配器裁剪
  if (matcher.length >= 2 && matcher.startsWith("/") && matcher.endsWith("/")) {
    try {
      return new RegExp(matcher.slice(1, -1)).test(subject);
    } catch {
      return false; // 正则写错当作不匹配，配置校验会另行提示
    }
  }
  if (matcher.includes("|")) {
    return matcher.split("|").some((part) => part.trim() === subject);
  }
  return matcher === subject;
}

const DECISIONS: readonly HookDecision[] = ["allow", "ask", "deny"];

/** 解析钩子的 stdout。容忍"日志 + 末尾一行 JSON"的写法：取最后一个能解析成对象的行。 */
export function parseHookOutput(stdout: string): HookOutput | null {
  const lines = stdout.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line === undefined || line === "" || !line.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const raw = parsed as Record<string, unknown>;
    const output: HookOutput = {};
    if (
      typeof raw.decision === "string" &&
      (DECISIONS as readonly string[]).includes(raw.decision)
    ) {
      output.decision = raw.decision as HookDecision;
    }
    if (typeof raw.reason === "string") output.reason = raw.reason;
    if (typeof raw.additionalContext === "string") output.additionalContext = raw.additionalContext;
    if (typeof raw.continue === "boolean") output.continue = raw.continue;
    // 空对象（无字段）不当作有效决定——避免"随便打印个 {}"就影响行为。
    if (Object.keys(output).length === 0) continue;
    return output;
  }
  return null;
}

const RANK: Record<HookDecision, number> = { allow: 0, ask: 1, deny: 2 };

export function mergeHookRuns(runs: HookRunResult[]): MergedDecision {
  let best: HookDecision | null = null;
  const reasons: string[] = [];
  const additionalContext: string[] = [];
  let stop = false;

  for (const run of runs) {
    const output = run.output;
    if (output === null) continue;
    if (output.decision !== undefined) {
      if (best === null || RANK[output.decision] > RANK[best]) best = output.decision;
    }
    if (output.continue === false) {
      stop = true;
      // 「不继续」在工具路径上等价于拒绝（否则"阻止"就是一句空话）。
      if (best === null || RANK.deny > RANK[best]) best = "deny";
    }
    if (output.reason !== undefined) reasons.push(output.reason);
    if (output.additionalContext !== undefined) additionalContext.push(output.additionalContext);
  }

  return { decision: best, reasons, additionalContext, stop, runs };
}

/** 把合并结果拼成一句可读的原因（透传给模型/用户）。 */
export function describeDecision(merged: MergedDecision): string | undefined {
  if (merged.reasons.length === 0) return undefined;
  return merged.reasons.join("；");
}
