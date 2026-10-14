/**
 * 插件 hooks 的解析：Claude 的 `hooks/hooks.json` 语义 → 一份可直接挂到 pi 事件上的绑定表。
 *
 * 宽松解析（与清单、角色文件同一口径）：不认识的字段、非 `command` 型 handler、认不出的 matcher
 * 正则都只出诊断，不影响其它 hook 与其他插件。**执行类组件**，由来源门控决定是否真的挂上。
 */

import type { PluginDiagnosticView } from "@ucode/contracts";
import { z } from "zod";

import { diagnostic } from "./diagnostic";
import { resolvePluginVariables } from "./variables";

/** Claude 事件名 → 本产品认识的事件。pi 没有独立的权限事件，`PermissionRequest` 不在此表内 */
export const PLUGIN_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
] as const;

export type PluginHookEvent = (typeof PLUGIN_HOOK_EVENTS)[number];

/** 通道支持的事件：只有通知类事件能 `async: true`（决策类必须同步等结论） */
export const PLUGIN_HOOK_ASYNC_EVENTS: readonly PluginHookEvent[] = ["SessionStart", "Stop"];

/** 默认超时：与 Claude 一致 */
export const PLUGIN_HOOK_DEFAULT_TIMEOUT_SECONDS = 60;

/** 一条可执行的 hook：起一个子进程，按事件喂 JSON、按事件读结论 */
export type PluginHookBinding = {
  /** 归属插件（诊断与排查用） */
  pluginId: string;
  /** 插件安装目录：喂给子进程做 `${*_PLUGIN_ROOT}` */
  pluginRoot: string;
  /** 插件持久数据目录：喂给子进程做 `${*_PLUGIN_DATA}`（首次引用时创建） */
  pluginDataDir: string;
  /** `userConfig` 的已存值：子进程经 `*_PLUGIN_OPTION_<KEY>` 读到 */
  config: Record<string, string | number | boolean>;
  event: PluginHookEvent;
  /** 工具名正则（只对带 matcher 的事件有意义）；缺省即匹配全部 */
  matcher?: string;
  command: string;
  timeoutMs: number;
  /** 只对通知类事件生效 */
  isAsync: boolean;
};

const hookEntrySchema = z.object({
  type: z.string().optional(),
  command: z.string().optional(),
  timeout: z.number().positive().optional(),
  async: z.boolean().optional(),
});

const matcherGroupSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(z.unknown()).optional(),
});

/**
 * 顶层既可是 `{ hooks: { 事件: [...] } }`（文件写法），也可是直接的事件表（清单内联写法）。
 * 这里只判断形状；每个事件的值是不是数组由下面逐条诊断。
 */
const normalizeRoot = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = "hooks" in record ? record.hooks : record;
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return null;
  return nested as Record<string, unknown>;
};

export type PluginHookLoad = {
  bindings: PluginHookBinding[];
  diagnostics: PluginDiagnosticView[];
};

/**
 * 解析一个插件的 hooks 配置。`source` 用于诊断文案（内联 / 文件）；单个 hook 失败只跳过它。
 */
export const loadPluginHooks = (input: {
  pluginId: string;
  pluginRoot: string;
  pluginDataDir: string;
  config: Record<string, string | number | boolean>;
  source: string;
  value: unknown;
  /** 会话工作目录：解析 `${*_PROJECT_DIR}` 用；装配期还不知道时缺省 */
  projectDir?: string;
}): PluginHookLoad => {
  const bindings: PluginHookBinding[] = [];
  const diagnostics: PluginDiagnosticView[] = [];
  const root = normalizeRoot(input.value);
  if (!root) {
    diagnostics.push(
      diagnostic("error", "hooks", `${input.source}：不是 "hooks" 对象形状，已跳过`),
    );
    return { bindings, diagnostics };
  }

  for (const [eventName, rawGroups] of Object.entries(root)) {
    if (!Array.isArray(rawGroups)) {
      diagnostics.push(
        diagnostic("error", "hooks", `${input.source}：事件 ${eventName} 的值必须是数组，已跳过`),
      );
      continue;
    }
    const groups = rawGroups;
    if (!(PLUGIN_HOOK_EVENTS as readonly string[]).includes(eventName)) {
      diagnostics.push(
        diagnostic("info", "hooks", `${input.source}：事件 ${eventName} 本轮不实现，已忽略`),
      );
      continue;
    }
    const event = eventName as PluginHookEvent;

    for (const rawGroup of groups) {
      const group = matcherGroupSchema.safeParse(rawGroup);
      if (!group.success) {
        diagnostics.push(
          diagnostic("error", "hooks", `${input.source}：${eventName} 的条目形状非法`),
        );
        continue;
      }
      const matcher = group.data.matcher?.trim() || undefined;
      if (matcher && !isUsableRegex(matcher)) {
        diagnostics.push(
          diagnostic(
            "error",
            "hooks",
            `${input.source}：${eventName} 的 matcher 不是合法正则：${matcher}`,
          ),
        );
        continue;
      }

      for (const rawEntry of group.data.hooks ?? []) {
        const entry = hookEntrySchema.safeParse(rawEntry);
        if (!entry.success || !entry.data.command?.trim()) {
          diagnostics.push(
            diagnostic("error", "hooks", `${input.source}：${eventName} 的 handler 缺少 command`),
          );
          continue;
        }
        // 非 command 型（http / mcp_tool / prompt / agent）本轮不实现：明确记诊断，不静默降级成 command
        if (entry.data.type !== undefined && entry.data.type !== "command") {
          diagnostics.push(
            diagnostic(
              "info",
              "hooks",
              `${input.source}：handler 类型 ${entry.data.type} 本轮不实现，已忽略`,
            ),
          );
          continue;
        }
        const wantsAsync = entry.data.async === true;
        if (wantsAsync && !PLUGIN_HOOK_ASYNC_EVENTS.includes(event)) {
          diagnostics.push(
            diagnostic(
              "warning",
              "hooks",
              `${input.source}：${eventName} 是决策类事件，async 不生效，已按同步执行`,
            ),
          );
        }
        // shell 形式的 command 上禁止 `${user_config.*}`：值会被 shell 再解析
        const command = resolvePluginVariables(entry.data.command.trim(), {
          pluginRoot: input.pluginRoot,
          pluginDataDir: input.pluginDataDir,
          config: input.config,
          allowUserConfig: false,
          ...(input.projectDir ? { projectDir: input.projectDir } : {}),
        });
        for (const message of command.diagnostics) {
          diagnostics.push(diagnostic("warning", "hooks", `${input.source}：${message}`));
        }

        bindings.push({
          pluginId: input.pluginId,
          pluginRoot: input.pluginRoot,
          pluginDataDir: input.pluginDataDir,
          config: input.config,
          event,
          ...(matcher ? { matcher } : {}),
          command: command.text,
          timeoutMs: Math.round((entry.data.timeout ?? PLUGIN_HOOK_DEFAULT_TIMEOUT_SECONDS) * 1000),
          isAsync: wantsAsync && PLUGIN_HOOK_ASYNC_EVENTS.includes(event),
        });
      }
    }
  }

  return { bindings, diagnostics };
};

const isUsableRegex = (value: string): boolean => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};

/** 工具名是否命中 matcher；没有 matcher 即全部命中 */
export const matchesToolName = (binding: PluginHookBinding, toolName: string): boolean => {
  if (!binding.matcher) return true;
  try {
    return new RegExp(binding.matcher).test(toolName);
  } catch {
    return false;
  }
};
