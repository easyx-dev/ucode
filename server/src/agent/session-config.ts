/**
 * 会话装配层：把「会话覆盖值 + 运行时 + 角色能力 + 权限」收敛成 pi 的会话创建参数。
 *
 * 角色（主会话模式 / 子智能体）、权限、工具集、提示词源都从这里汇入，是这些能力的唯一入口。
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
import {
  type AgentProfile,
  agentRules,
  effectiveToolNames,
  PRIMARY_PROFILES,
  primaryCapability,
  type ResolvedCapability,
  usesDefaultToolSet,
} from "./agents";
import { mcpExtensionForMode } from "./mcp";
import type { MemoryService } from "./memory";
import {
  createPermissionExtension,
  type PermissionHooks,
  type PermissionRule,
} from "./permissions";
import {
  buildFullPrompt,
  buildPromptOverlay,
  type PromptVariant,
  promptSectionOf,
  resolvePromptVariant,
} from "./prompt";
import type { SubagentHooks } from "./subagents";
import { buildCustomTools } from "./tools/index";
import { SUBAGENT_TOOL_NAME } from "./tools/names";
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
  /** 主会话模式；子会话沿用父会话的模式 */
  mode: SessionMode;
  sessionManager: SessionManager;
  runtime: PiRuntime;
  /** 已解析的角色；缺省按 `mode` 取主角色 */
  profile?: AgentProfile;
  /** 已与父会话取交集的能力；缺省按角色声明解析（主会话路径） */
  capability?: ResolvedCapability;
  /** 子会话的父会话规则；提供时权限判定取较严者，保证能力只可收窄 */
  parentRules?: () => readonly PermissionRule[];
  /** 仅主会话提供：注册 `subagent` 工具；子会话不提供，天然禁递归 */
  subagents?: SubagentHooks;
  /** 实时读取联网搜索设置：设置页保存后新建的会话即按新 key 生效 */
  websearch: () => WebsearchConfig;
  /** 权限钩子：审批回调与会话恒允，由会话池按 sessionId 提供 */
  permission: PermissionHooks;
  /** question 工具通道：向本会话前端提问并等待答复，由会话池按 sessionId 提供 */
  question?: QuestionHooks;
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
  input: {
    mode: SessionMode;
    agentSection: string;
    tools: readonly string[];
    variant: PromptVariant;
    memoryEnabled: boolean;
  },
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
  profile: AgentProfile,
  capability: ResolvedCapability,
  toolNames: readonly string[],
  settingsManager: SettingsManager,
  variant: PromptVariant,
): Promise<DefaultResourceLoader> => {
  const gate = {
    cwd: input.cwd,
    // 现取规则：本会话恒允是追加的 allow 规则，下一次判定就要生效
    rules: () => [...agentRules(profile), ...input.permission.listGrants()],
    parentRules: input.parentRules,
    grant: input.permission.grant,
    request: input.permission.request,
  };
  const memoryFile = input.memory?.indexFile(input.cwd) ?? null;
  // MCP / tool_search 只在「继承默认工具集」的会话里挂：白名单会话（plan / ask / explore）
  // 本就够不着扩展工具，连了也是白连；MCP 还会激活 codemode，绕过只读白名单（见 agent/mcp）
  const withExtensions = input.mode === "build" && usesDefaultToolSet(capability);
  const mcpExtension = withExtensions
    ? mcpExtensionForMode(input.mode, input.agentDir ?? env.agentDir)
    : undefined;
  // tool_search 只注册、默认不激活：build 下 MCP 出现 deferred 服务器时由 MCP 扩展自动激活
  const discoveryExtension = withExtensions ? [createToolSearchExtension()] : [];
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
      agentSection: promptSectionOf(profile),
      tools: toolNames,
      variant,
      memoryEnabled: input.memory?.enabled === true,
    }),
  });
  await loader.reload();
  return loader;
};

/**
 * 组装 AgentSession 的创建参数；模型与档位按「会话覆盖 > 角色定义 > 全局默认」解析。
 * 异步是因为要先 `reload()` resourceLoader 才能建出会话。
 */
export const buildSessionOptions = async (
  input: SessionAssemblyInput,
): Promise<CreateAgentSessionOptions> => {
  const profile = input.profile ?? PRIMARY_PROFILES[input.mode];
  const capability = input.capability ?? primaryCapability(input.mode);
  // 可用工具名同时决定「注册哪些自研工具」与「提示词列哪些工具」；
  // 依赖钩子的工具（question / subagent）在钩子缺失时一并去掉，避免提示词提到不存在的工具
  const toolNames = effectiveToolNames(capability).filter(
    (name) =>
      (name !== "question" || Boolean(input.question)) &&
      (name !== SUBAGENT_TOOL_NAME || Boolean(input.subagents)),
  );
  const override = overrideOf(input.record);
  const modelRef = override.model ?? capability.model ?? null;
  const model = input.runtime.resolveModelRef(modelRef) ?? input.runtime.resolveModelRef(null);
  const thinkingLevel =
    override.thinkingLevel ?? capability.thinkingLevel ?? input.runtime.getStatus().thinkingLevel;

  // loader 与会话共用同一个 SettingsManager：分两个实例会让资源发现与运行期设置不一致
  const settingsManager = SettingsManager.inMemory();
  const variant = resolvePromptVariant(model ? `${model.provider}/${model.id}` : null);
  const loader = await createSessionLoader(
    input,
    profile,
    capability,
    toolNames,
    settingsManager,
    variant,
  );
  const { toolSelection } = capability;
  // 覆盖必须在 loader.reload() 之后：reload 会重读设置，冲掉 reload 前的 in-memory 覆盖
  if (toolSelection.kind === "defaultTools")
    settingsManager.applyOverrides({ defaultTools: toolSelection.defaultTools });

  // 记忆工具只在主会话的 build 模式注册；子会话与只读模式都不纳入
  const memoryTools =
    profile.kind === "primary" && input.mode === "build"
      ? (input.memory?.tools(input.cwd) ?? [])
      : [];

  return {
    cwd: input.cwd,
    agentDir: input.agentDir ?? env.agentDir,
    modelRuntime: input.runtime.requireRuntime(),
    ...(model ? { model } : {}),
    thinkingLevel,
    sessionManager: input.sessionManager,
    settingsManager,
    ...(toolSelection.kind === "allowlist" ? { tools: toolSelection.tools } : {}),
    ...(capability.excludeTools.length > 0 ? { excludeTools: [...capability.excludeTools] } : {}),
    customTools: buildCustomTools({
      names: toolNames,
      readWebsearchConfig: input.websearch,
      ...(input.question ? { question: input.question } : {}),
      ...(input.subagents ? { subagents: input.subagents } : {}),
      memoryTools,
    }),
    resourceLoader: loader,
  };
};
