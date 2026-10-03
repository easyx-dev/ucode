/**
 * 会话装配层：把「会话覆盖值 + 运行时 + 模式 + 权限」收敛成 pi 的会话创建参数。
 *
 * 模式、权限、工具集、提示词源都从这里汇入，是这些能力的唯一入口。
 * pi 没有「构造后注册 tool_call 处理器」的入口，权限规则只能经内联扩展 +
 * `DefaultResourceLoader({ extensionFactories })` 注入，所以这里同时负责装配 resourceLoader。
 */
import {
  type CreateAgentSessionOptions,
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  type SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionMode, WebsearchConfig } from "@ucode/contracts";

import type { PromptSource } from "../constants";
import type { PiRuntime } from "../core/runtime";
import { overrideOf, type SessionRecord } from "../db/session-repository";
import { env } from "../env";
import { mcpExtensionForMode } from "./mcp";
import type { MemoryService } from "./memory";
import { MODES, rulesForMode } from "./modes";
import { createPermissionExtension, type PermissionHooks } from "./permissions";
import {
  buildFullPrompt,
  buildPromptOverlay,
  type PromptVariant,
  resolvePromptVariant,
} from "./prompt";
import { buildCustomTools } from "./tools/index";
import type { QuestionHooks } from "./tools/question";
import { workspaceDirOf } from "./workspace";

/**
 * 会话工作目录：绑定目录的用那个目录，未绑定的用按会话 id 派生的工作区。
 * 调用方只会拿到已存在的会话（`admitPrompt` 先挡了查不到的 id），所以这里没有兜底分支——
 * 不存在「没有记录」时该用哪个目录的说法，真要兜也只能兜到全局目录（`$APP_HOME`），那里放着密钥。
 */
export const resolveSessionCwd = (record: SessionRecord): string =>
  record.cwd || workspaceDirOf(record.id);

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
  /** question 工具通道：向本会话前端提问并等待答复，由会话池按 sessionId 提供 */
  question: QuestionHooks;
  /** 项目级记忆：索引注入与 remember / forget 工具；缺省即不启用 */
  memory?: MemoryService;
  /** 系统提示词源；缺省取 `env.promptSource`（评测脚本需要按源对比时显式传入） */
  promptSource?: PromptSource;
  /** agent 数据目录；缺省取 `env.agentDir`（评测 / 测试需要隔离时显式传入） */
  agentDir?: string;
};

/** 提示词源的资源装载参数：`custom` 整段替换，其余源把自研片段追加到 pi 默认提示词之后 */
const promptLoaderOptions = (
  source: PromptSource,
  input: { mode: SessionMode; variant: PromptVariant; memoryEnabled: boolean },
): Pick<
  ConstructorParameters<typeof DefaultResourceLoader>[0],
  "systemPromptOverride" | "appendSystemPrompt"
> =>
  source === "custom"
    ? { systemPromptOverride: () => buildFullPrompt(input) }
    : { appendSystemPrompt: [buildPromptOverlay(input)] };

/**
 * 组装 resourceLoader：内联扩展负责 `tool_call` 权限拦截与内置 `codemode`，
 * 系统提示词按 `promptSource` 装配（见 `agent/prompt`），项目记忆开启时把记忆索引并入上下文文件。
 */
const createSessionLoader = async (
  input: SessionAssemblyInput,
  settingsManager: SettingsManager,
  variant: PromptVariant,
): Promise<DefaultResourceLoader> => {
  const gate = {
    cwd: input.cwd,
    // 现取规则：本会话恒允是追加的 allow 规则，下一次判定就要生效
    rules: () => [...rulesForMode(input.mode), ...input.permission.listGrants()],
    grant: input.permission.grant,
    request: input.permission.request,
  };
  const memoryFile = input.memory?.indexFile(input.cwd) ?? null;
  // MCP 只进 build；只读模式加载它会被扩展激活的 codemode 绕过工具白名单
  const mcpExtension = mcpExtensionForMode(input.mode, input.agentDir ?? env.agentDir);
  // tool_search 只注册、默认不激活：build 下 MCP 出现 deferred 服务器时由 MCP 扩展自动激活
  const discoveryExtension = input.mode === "build" ? [createToolSearchExtension()] : [];
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir ?? env.agentDir,
    settingsManager,
    extensionFactories: [
      createPermissionExtension(gate),
      createCodemodeExtension({ mode: "on" }),
      ...discoveryExtension,
      ...(mcpExtension ? [mcpExtension] : []),
    ],
    // 记忆索引作为额外的上下文文件拼进系统提示词；索引在会话创建时读一次即可
    ...(memoryFile
      ? { agentsFilesOverride: (base) => ({ agentsFiles: [...base.agentsFiles, memoryFile] }) }
      : {}),
    ...promptLoaderOptions(input.promptSource ?? env.promptSource, {
      mode: input.mode,
      variant,
      memoryEnabled: input.memory?.enabled === true,
    }),
  });
  await loader.reload();
  return loader;
};

/**
 * 组装 AgentSession 的创建参数；模型与档位按「会话覆盖 > 全局默认」解析。
 * 异步是因为要先 `reload()` resourceLoader 才能建出会话。
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
  const variant = resolvePromptVariant(model ? `${model.provider}/${model.id}` : null);
  const loader = await createSessionLoader(input, settingsManager, variant);
  const { toolSelection } = MODES[input.mode];
  // 覆盖必须在 loader.reload() 之后：reload 会重读设置，冲掉 reload 前的 in-memory 覆盖
  if (toolSelection.kind === "defaultTools")
    settingsManager.applyOverrides({ defaultTools: toolSelection.defaultTools });

  // 记忆工具只在 build 模式注册；plan / ask 的只读白名单不纳入
  const memoryTools = input.mode === "build" ? (input.memory?.tools(input.cwd) ?? []) : [];

  return {
    cwd: input.cwd,
    agentDir: input.agentDir ?? env.agentDir,
    modelRuntime: input.runtime.requireRuntime(),
    ...(model ? { model } : {}),
    thinkingLevel,
    sessionManager: input.sessionManager,
    settingsManager,
    ...(toolSelection.kind === "allowlist" ? { tools: toolSelection.tools } : {}),
    customTools: buildCustomTools(input.websearch, input.mode, input.question, memoryTools),
    resourceLoader: loader,
  };
};
