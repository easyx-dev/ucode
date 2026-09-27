import { spawn } from "node:child_process";
import { matchesHookMatcher, mergeHookRuns, parseHookOutput } from "./output.ts";
import type { HookInput, HookRegistration, HookRunResult, MergedDecision } from "./types.ts";

/**
 * 钩子的子进程执行（F-3.7）。
 *
 * 协议（V-9 已验证）：**stdin 一行 JSON（输入）→ stdout 一行 JSON（决定）**。
 * 失败处置刻意"宽松"：超时、非零退出、输出不合法都记为**无决定**（不拦不允），
 * 只有钩子**明确说出决定**才影响行为——一个写坏的钩子不该把整个 agent 卡死。
 * 这是可诊断性优先的选择：问题记进 `error`，由上层决定是否提示用户。
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1_000_000;

export async function runHook(
  registration: HookRegistration,
  input: HookInput,
): Promise<HookRunResult> {
  const startedAt = Date.now();
  const timeoutMs = registration.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [file, args] =
    typeof registration.command === "string"
      ? ["sh", ["-c", registration.command]]
      : [registration.command[0] as string, registration.command.slice(1)];

  return new Promise<HookRunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(file, args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        UCODE_HOOK_EVENT: input.event,
        UCODE_SESSION_ID: input.sessionId,
      },
    });

    const finish = (error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 只有干净退出（error 为空）才认输出；超时/非零退出即便打印了 JSON 也不算数。
      const output = error === undefined ? parseHookOutput(stdout) : null;
      resolve({
        registration,
        output,
        ...(error === undefined ? {} : { error }),
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(`钩子超时（${timeoutMs}ms）：${describeCommand(registration)}`);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(`钩子启动失败：${String(error)}`));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(`钩子退出码 ${String(code)}${stderr.trim() === "" ? "" : `：${stderr.trim()}`}`);
    });

    child.stdin.on("error", () => {
      // 钩子没读 stdin 就退出：不是错误，继续等 close。
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

/** 依次执行匹配该事件的钩子，并合并决定。 */
export async function runHooks(
  registrations: HookRegistration[],
  event: HookInput["event"],
  subject: string | undefined,
  buildInput: () => HookInput,
): Promise<MergedDecision> {
  const matching = registrations.filter(
    (registration) =>
      registration.event === event && matchesHookMatcher(registration.matcher, subject),
  );
  const runs: HookRunResult[] = [];
  for (const registration of matching) {
    // 每条钩子独立构建输入：钩子之间不共享可变对象，避免互相污染。
    runs.push(await runHook(registration, buildInput()));
  }
  return mergeHookRuns(runs);
}

function describeCommand(registration: HookRegistration): string {
  return typeof registration.command === "string"
    ? registration.command
    : registration.command.join(" ");
}
