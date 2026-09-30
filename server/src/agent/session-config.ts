/**
 * 会话装配层：把「会话覆盖值 + 运行时 + 模式 + 权限」收敛成 pi 的会话创建参数。
 *
 * 模式、权限、工具集、提示词片段都从这里汇入，是这些能力的唯一入口。
 * pi 没有「构造后注册 tool_call 处理器」的入口，权限规则只能经内联扩展 +
 * `DefaultResourceLoader({ extensionFactories })` 注入，所以这里同时负责装配 resourceLoader。
 */
import {
  type CreateAgentSessionOptions,
  DefaultResourceLoader,
  type SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionMode, WebsearchConfig } from "@ucode/contracts";

import type { PiRuntime } from "../core/runtime";
import { overrideOf, type SessionRecord } from "../db/session-repository";
import { env } from "../env";
import { MODES, rulesForMode } from "./modes";
import { createPermissionExtension, type PermissionHooks } from "./permissions";
import { buildSessionTools } from "./tools/index";

/** 会话工作目录：已落盘会话 > 覆盖值 > 调用方指定 > 全局工作目录 */
export const resolveSessionCwd = (
  record: SessionRecord | undefined,
  cwdOverride?: string,
): string => record?.piCwd || record?.cwd || cwdOverride || env.workspaceDir;

/**
 * 模式白名单：`build` 用全部可用工具（含扩展工具），其余模式只保留模式声明的能力集。
 * 扩展工具即 `$APP_HOME/pi/extensions` 与项目 `.pi/extensions` 注册的工具。
 */
export const resolveModeTools = (
  mode: SessionMode,
  available: readonly string[],
  extensionTools: readonly string[],
): string[] => {
  const declared = MODES[mode].tools;
  if (!declared) return [...new Set([...available, ...extensionTools])];
  const allowed = new Set(declared);
  return available.filter((name) => allowed.has(name));
};

export type SessionAssemblyInput = {
  record: SessionRecord | undefined;
  /** 已由 `resolveSessionCwd` 解析好的工作目录 */
  cwd: string;
  mode: SessionMode;
  sessionManager: SessionManager;
  runtime: PiRuntime;
  /** 实时读取联网搜索设置：设置页保存后新建的会话即按新 key 生效 */
  websearch: () => WebsearchConfig;
  /** 权限钩子：审批回调与会话恒允，由会话池按 sessionId 提供 */
  permission: PermissionHooks;
};

/**
 * 组装 resourceLoader：内联扩展负责 `tool_call` 权限拦截，模式片段追加到系统提示词。
 * `reload()` 后才能读到扩展注册的工具名，`build` 模式据此把它们纳入白名单。
 */
const createSessionLoader = async (
  input: SessionAssemblyInput,
  settingsManager: SettingsManager,
): Promise<{ loader: DefaultResourceLoader; extensionTools: string[] }> => {
  const gate = {
    cwd: input.cwd,
    // 现取规则：本会话恒允是追加的 allow 规则，下一次判定就要生效
    rules: () => [...rulesForMode(input.mode), ...input.permission.listGrants()],
    grant: input.permission.grant,
    request: input.permission.request,
  };
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: env.piDir,
    settingsManager,
    extensionFactories: [createPermissionExtension(gate)],
    appendSystemPrompt: [MODES[input.mode].prompt],
  });
  await loader.reload();
  const extensionTools = loader
    .getExtensions()
    .extensions.flatMap((extension) => [...extension.tools.keys()]);
  return { loader, extensionTools };
};

/**
 * 组装 AgentSession 的创建参数；模型与档位按「会话覆盖 > 全局默认」解析。
 * 异步是因为要先 `reload()` resourceLoader 才能拿到扩展工具名。
 */
export const buildSessionOptions = async (
  input: SessionAssemblyInput,
): Promise<CreateAgentSessionOptions> => {
  const override = overrideOf(input.record);
  const model =
    input.runtime.resolveModelRef(override.model) ?? input.runtime.resolveModelRef(null);
  const thinkingLevel = override.thinkingLevel ?? input.runtime.getStatus().thinkingLevel;

  // loader 与会话共用同一个 SettingsManager：分两个实例会让资源发现与运行期设置不一致
  const settingsManager = SettingsManager.inMemory();
  const { loader, extensionTools } = await createSessionLoader(input, settingsManager);
  const { customTools, tools: availableTools } = buildSessionTools(input.websearch);

  return {
    cwd: input.cwd,
    agentDir: env.piDir,
    modelRuntime: input.runtime.requireRuntime(),
    ...(model ? { model } : {}),
    thinkingLevel,
    sessionManager: input.sessionManager,
    settingsManager,
    tools: resolveModeTools(input.mode, availableTools, extensionTools),
    customTools,
    resourceLoader: loader,
  };
};
