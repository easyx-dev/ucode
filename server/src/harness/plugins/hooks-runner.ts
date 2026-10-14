/**
 * 插件 hooks 的执行与挂载：起子进程喂 JSON、读结论，再按事件把结论接进 pi。
 *
 * 安全边界（见 `plans/plugins.md` 4.2）：**hook 只能收紧**。`PreToolUse` 的 block 与权限扩展的
 * `deny` 天然取并集——两者各自返回 `block`，任一方阻断即阻断；钩子挂载顺序排在权限扩展之后，
 * 权限先判定、hook 只做追加。
 */

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { brand } from "@ucode/brand/values";
import { execa } from "execa";

import { logger } from "../../platform/logger";
import { matchesToolName, type PluginHookBinding, type PluginHookEvent } from "./hooks";
import { ensurePluginDataDir } from "./variables";

/** 喂给 hook 子进程的载荷：字段名沿用 Claude，插件作者不用改脚本 */
export type PluginHookPayload = {
  hook_event_name: PluginHookEvent;
  cwd: string;
  session_id: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
};

export type PluginHookOutcome = {
  /** 是否阻断（exit 2，或 stdout 里的 block 决策） */
  blocked: boolean;
  /** 阻断原因：stderr，或 stdout 的 reason */
  reason?: string;
  /** 追加上下文的文本（`hookSpecificOutput.additionalContext`） */
  additionalContext?: string;
  /** 一行执行摘要，供日志与排查 */
  summary: string;
};

/** 事件名对应的环境变量前缀：由品牌 slug 派生，避免硬编码品牌名 */
const ENV_PREFIX = brand.slug.toUpperCase();

/**
 * hook 子进程的环境：插件目录 / 数据目录 / 项目目录，并给出 `CLAUDE_*` 别名——
 * 按 Claude 写的 hook 脚本不用改就能读到同样的变量。
 */
export const hookEnv = (
  binding: PluginHookBinding,
  cwd: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const root = binding.pluginRoot;
  ensurePluginDataDir(binding.pluginDataDir);
  const values: Record<string, string> = {
    [`${ENV_PREFIX}_PLUGIN_ROOT`]: root,
    CLAUDE_PLUGIN_ROOT: root,
    ZCODE_PLUGIN_ROOT: root,
    [`${ENV_PREFIX}_PLUGIN_DATA`]: binding.pluginDataDir,
    CLAUDE_PLUGIN_DATA: binding.pluginDataDir,
    ZCODE_PLUGIN_DATA: binding.pluginDataDir,
    [`${ENV_PREFIX}_PROJECT_DIR`]: cwd,
    CLAUDE_PROJECT_DIR: cwd,
    ZCODE_PROJECT_DIR: cwd,
  };
  // userConfig 的值走 `*_PLUGIN_OPTION_<KEY>`（键名转大写、非字母数字换 `_`）
  for (const [key, value] of Object.entries(binding.config)) {
    const normalized = key.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    values[`${ENV_PREFIX}_PLUGIN_OPTION_${normalized}`] = String(value);
    values[`CLAUDE_PLUGIN_OPTION_${normalized}`] = String(value);
  }
  return { ...base, ...values };
};

/** stdout 里可能出现的决策形状；认不出就当没有结论 */
const readOutcome = (
  stdout: string,
): Pick<PluginHookOutcome, "blocked" | "reason" | "additionalContext"> => {
  const trimmed = stdout.trim();
  if (!trimmed) return { blocked: false };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return { blocked: false };
    const record = parsed as Record<string, unknown>;
    const specific =
      typeof record.hookSpecificOutput === "object" && record.hookSpecificOutput !== null
        ? (record.hookSpecificOutput as Record<string, unknown>)
        : {};
    const decision = record.decision ?? record.permissionDecision;
    const additionalContext =
      typeof specific.additionalContext === "string" ? specific.additionalContext : undefined;
    return {
      blocked: decision === "block" || decision === "deny",
      ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
      ...(additionalContext ? { additionalContext } : {}),
    };
  } catch {
    // stdout 不是 JSON：按 Claude 的口径当没有结论（正文只用于日志）
    return { blocked: false };
  }
};

/** 探测结果缓存：一次运行内不会变，而它在每次 hook 调用上都要用（PreToolUse 与工具调用同频，逐个绑定会重复跑） */
let gitBashPath: string | null | undefined;

/**
 * Windows 上 Git Bash 的常见位置：`Program Files` 下的标准安装，或在 PATH 上的 Cygwin / MSYS2。
 * 只做够用的探测，不穷举——本仓库的 `bash` 工具本来就要求装 Git for Windows。
 */
const probeGitBash = (): string | null => {
  const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]];
  for (const dir of programFiles) {
    if (!dir) continue;
    const candidate = join(dir, "Git", "bin", "bash.exe");
    if (existsSync(candidate)) return candidate;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "bash.exe");
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const findGitBash = (): string | null => {
  if (gitBashPath === undefined) gitBashPath = probeGitBash();
  return gitBashPath;
};

/**
 * hook 命令交给谁执行。
 *
 * Claude 生态的 hook 是 `.sh` 脚本加 `$CLAUDE_PLUGIN_ROOT` 这类 POSIX 变量语法，`cmd.exe` 两个都不认，
 * 所以 Windows 上优先走 Git Bash；找不到才回退到 `shell: true`（即 cmd.exe），此时用 `.cmd` / `.bat`
 * 写的 hook 仍然可用。
 */
const resolveHookInvocation = (
  command: string,
): { file: string; args: string[]; shell: boolean } => {
  if (process.platform === "win32") {
    const bash = findGitBash();
    // 不带 shell：命令原样作为一个参数交给 bash -c，不必再跟引号规则搏斗
    if (bash) return { file: bash, args: ["-c", command], shell: false };
  }
  return { file: command, args: [], shell: true };
};

/**
 * 执行一次 hook。失败一律**不阻断**（除非 exit 2）：hook 是别人的进程，
 * 它自己崩掉不该把用户这一轮卡死；超时同理。
 */
export const runPluginHook = async (
  binding: PluginHookBinding,
  payload: PluginHookPayload,
): Promise<PluginHookOutcome> => {
  const invocation = resolveHookInvocation(binding.command);
  const result = await execa(invocation.file, invocation.args, {
    shell: invocation.shell,
    input: `${JSON.stringify(payload)}\n`,
    timeout: binding.timeoutMs,
    reject: false,
    env: hookEnv(binding, payload.cwd),
  });

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const timedOut = result.timedOut === true;
  const outcome = readOutcome(stdout);

  if (timedOut) {
    return {
      blocked: false,
      summary: `超时（${binding.timeoutMs}ms）`,
    };
  }

  // exit 2 是 Claude 的「阻断」约定；stderr 即原因
  if (result.exitCode === 2) {
    return {
      blocked: true,
      reason: (outcome.reason ?? stderr.trim()) || "hook 阻止了这次调用",
      ...(outcome.additionalContext ? { additionalContext: outcome.additionalContext } : {}),
      summary: "exit 2 → 阻断",
    };
  }

  if (outcome.blocked) {
    return {
      blocked: true,
      reason: outcome.reason ?? "hook 阻止了这次调用",
      ...(outcome.additionalContext ? { additionalContext: outcome.additionalContext } : {}),
      summary: "stdout 决策 → 阻断",
    };
  }

  // hook 没按预期生效时，原因多半在 stderr 里：摘要只给结论，细节留日志（界面上不刷屏）
  if (result.exitCode !== 0) {
    logger.warn(
      {
        command: binding.command,
        exitCode: result.exitCode,
        stderr: stderr.trim().slice(-500),
      },
      "插件 hook 非零退出（不阻断）",
    );
  }
  const notice = result.exitCode !== 0 ? `非零退出（${result.exitCode}），不阻断` : "通过";
  return {
    blocked: false,
    ...(outcome.additionalContext ? { additionalContext: outcome.additionalContext } : {}),
    summary: notice,
  };
};

/** 命令式 hook 挂到 pi 事件上所需的会话上下文 */
export type PluginHooksContext = {
  cwd: string;
  sessionId: string;
};

/** 一次调用里按事件顺序跑完所有绑定，任一阻断即阻断（决策取并集） */
const runBindings = async (
  bindings: readonly PluginHookBinding[],
  payload: PluginHookPayload,
): Promise<PluginHookOutcome[]> => {
  const outcomes: PluginHookOutcome[] = [];
  for (const binding of bindings) {
    try {
      outcomes.push(await runPluginHook(binding, payload));
    } catch (error) {
      // 起不来（命令不存在等）不阻断，但必须留痕，否则用户以为 hook 生效了
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        { pluginId: binding.pluginId, event: binding.event, reason },
        "插件 hook 执行失败",
      );
      outcomes.push({ blocked: false, summary: `执行失败：${reason}` });
    }
  }
  return outcomes;
};

const of = (bindings: readonly PluginHookBinding[], event: PluginHookEvent): PluginHookBinding[] =>
  bindings.filter((binding) => binding.event === event);

/**
 * 把绑定表挂成 pi 扩展。挂载顺序由装配方保证：本扩展排在权限扩展之后，
 * 权限的 `deny` 已先判定，hook 只能再收紧。
 */
export const createPluginHooksExtension =
  (input: {
    bindings: readonly PluginHookBinding[];
    cwd: string;
    sessionId: string;
  }): ExtensionFactory =>
  (pi) => {
    const payloadOf = (
      event: PluginHookEvent,
      extra: Partial<PluginHookPayload>,
    ): PluginHookPayload => ({
      hook_event_name: event,
      cwd: input.cwd,
      session_id: input.sessionId,
      ...extra,
    });

    const preToolUse = of(input.bindings, "PreToolUse");
    if (preToolUse.length > 0) {
      pi.on("tool_call", async (event) => {
        const matched = preToolUse.filter((binding) => matchesToolName(binding, event.toolName));
        if (matched.length === 0) return;
        const outcomes = await runBindings(
          matched,
          payloadOf("PreToolUse", { tool_name: event.toolName, tool_input: event.input }),
        );
        const blocked = outcomes.find((outcome) => outcome.blocked);
        if (!blocked) return;
        return { block: true, reason: blocked.reason ?? "插件 hook 阻止了这次调用" };
      });
    }

    const postToolUse = [
      ...of(input.bindings, "PostToolUse"),
      ...of(input.bindings, "PostToolUseFailure"),
    ];
    if (postToolUse.length > 0) {
      pi.on("tool_result", async (event) => {
        const isError = event.isError === true;
        const eventName: PluginHookEvent = isError ? "PostToolUseFailure" : "PostToolUse";
        const matched = postToolUse.filter(
          (binding) => binding.event === eventName && matchesToolName(binding, event.toolName),
        );
        if (matched.length === 0) return;
        // 结果只用来观察与注释：不替换内容（替换会丢 structuredContent，风险大于收益）
        await runBindings(
          matched,
          payloadOf(eventName, {
            tool_name: event.toolName,
            tool_input: event.input,
            tool_response: event.content,
          }),
        );
      });
    }

    const userPromptSubmit = of(input.bindings, "UserPromptSubmit");
    if (userPromptSubmit.length > 0) {
      pi.on("before_agent_start", async (event) => {
        const outcomes = await runBindings(
          userPromptSubmit,
          payloadOf("UserPromptSubmit", { prompt: event.prompt }),
        );
        const extra = outcomes
          .map((outcome) => outcome.additionalContext)
          .filter((value): value is string => Boolean(value));
        if (extra.length === 0) return;
        // 追加上下文走 message（`input` 只能改文本，塞不进结构化上下文）
        return {
          message: {
            customType: "plugin_hook_context",
            content: extra.join("\n\n"),
            display: false,
          },
        };
      });
    }

    const sessionStart = of(input.bindings, "SessionStart");
    if (sessionStart.length > 0) {
      pi.on("session_start", async () => {
        await runBindings(sessionStart, payloadOf("SessionStart", {}));
      });
    }

    const stop = of(input.bindings, "Stop");
    if (stop.length > 0) {
      // 只挂 `agent_settled`：它在一轮跑完后发一次；`agent_end` 是底层循环结束（含重试）时发的，
      // 两个都挂会让 Stop 命令在一轮里跑两遍以上（写盘、发通知、跑 formatter 这类不是幂等的）
      pi.on("agent_settled", async () => {
        await runBindings(stop, payloadOf("Stop", {}));
      });
    }
  };
