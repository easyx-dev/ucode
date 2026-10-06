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
import { DEFAULT_PERMISSION_MODE, type WebsearchConfig } from "@ucode/contracts";

import type { PromptSource } from "../constants";
import type { PiRuntime } from "../core/runtime";
import { overrideOf, type SessionRecord } from "../db/session-repository";
import { env } from "../env";
import {
  type AgentProfile,
  type AgentRegistry,
  agentRules,
  allSubagents,
  effectiveToolNames,
  loadAgentRegistry,
  primaryCapability,
  primaryProfile,
  type ResolvedCapability,
  usesDefaultToolSet,
} from "./agents";
import { commandAssetPaths } from "./assets";
import { mcpExtension } from "./mcp";
import type { MemoryService } from "./memory";
import {
  createPermissionExtension,
  type PermissionHooks,
  type PermissionRule,
  skillDirectoryRules,
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
  /** 主会话模式（primary agent slug）；子会话沿用父会话的模式 */
  mode: string;
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
  /** 子角色注册表（含自定义角色）；缺省按 `harnessDir` 加载，供 `subagent` 工具列角色 */
  agentRegistry?: AgentRegistry;
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
  /** 运行时数据目录；缺省取 `env.harnessDir`（评测 / 测试需要隔离时显式传入） */
  harnessDir?: string;
};

/** 提示词源的资源装载参数：`custom` 整段替换，其余源把自研片段追加到 pi 默认提示词之后 */
const promptLoaderOptions = (
  source: PromptSource,
  input: {
    mode: string;
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
 * 系统提示词按 `promptSource` 装配（见 `harness/prompt`），项目记忆开启时把记忆索引并入上下文文件。
 */
const createSessionLoader = async (
  input: SessionAssemblyInput,
  profile: AgentProfile,
  capability: ResolvedCapability,
  toolNames: readonly string[],
  settingsManager: SettingsManager,
  variant: PromptVariant,
): Promise<DefaultResourceLoader> => {
  // 命令与技能只认我们的目录（全局 $APP_HOME + 项目祖先的项目配置目录 + .agents 兼容），
  // 不读 pi 默认的技能目录与 cwd/.pi/*；顺序即同名优先级（pi first-wins）
  const assetPaths = commandAssetPaths({ cwd: input.cwd, appHome: env.homeDir });
  const gate = {
    cwd: input.cwd,
    // 现取规则：本会话恒允是追加的 allow 规则，下一次判定就要生效。
    // 技能目录放行排在模式规则之后、会话授权之前——越界读 SKILL.md 不再走审批
    rules: () => [
      ...agentRules(profile),
      ...skillDirectoryRules(assetPaths.skills.map((item) => item.path)),
      ...input.permission.listGrants(),
    ],
    // 会话级权限档位：在规则判定之后放宽 ask（见 permissions/engine 的 applyApprovalMode）
    approvalMode: overrideOf(input.record).permissionMode ?? DEFAULT_PERMISSION_MODE,
    parentRules: input.parentRules,
    grant: input.permission.grant,
    request: input.permission.request,
  };
  const memoryFile = input.memory?.indexFile(input.cwd) ?? null;
  // MCP / tool_search 只在「默认工具集」的会话里挂：白名单会话（plan / ask / explore，以及自定义只读角色）
  // 本就够不着扩展工具，连了也是白连；MCP 还会激活 codemode，绕过只读白名单（见 harness/mcp）
  const withExtensions = usesDefaultToolSet(capability);
  const mcp = withExtensions ? mcpExtension(input.harnessDir ?? env.harnessDir) : undefined;
  // tool_search 只注册、默认不激活：默认集会话出现 deferred MCP 服务器时由 MCP 扩展自动激活
  const discoveryExtension = withExtensions ? [createToolSearchExtension()] : [];
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.harnessDir ?? env.harnessDir,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    additionalSkillPaths: assetPaths.skills.map((item) => item.path),
    additionalPromptTemplatePaths: assetPaths.prompts.map((item) => item.path),
    extensionFactories: [
      createPermissionExtension(gate),
      createCodemodeExtension({ mode: "on" }),
      ...discoveryExtension,
      ...(mcp ? [mcp] : []),
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
  // 注册表同时决定 primary 与子角色：primary 走自定义（可覆盖内置），子会话取交集时也要它
  const registry =
    input.agentRegistry ?? loadAgentRegistry({ cwd: input.cwd, appHome: env.homeDir });
  const profile = input.profile ?? primaryProfile(input.mode, registry);
  const capability = input.capability ?? primaryCapability(input.mode, registry);
  // 可用工具名同时决定「注册哪些自研工具」与「提示词列哪些工具」；
  // 依赖钩子的工具（question / subagent）在钩子缺失时一并去掉，避免提示词提到不存在的工具
  const toolNames = effectiveToolNames(capability).filter(
    (name) =>
      (name !== "question" || Boolean(input.question)) &&
      (name !== SUBAGENT_TOOL_NAME || Boolean(input.subagents)),
  );
  const override = overrideOf(input.record);
  // 角色声明的模型（自定义角色 frontmatter）必须可解析：静默回落默认模型会把配置错误藏起来。
  // 会话覆盖值的模型在 create / update 已校验，这里只兜角色声明这一路
  if (capability.model && !input.runtime.resolveModelRef(capability.model)) {
    throw new Error(`角色指定的模型不可用：${capability.model}`);
  }
  const modelRef = override.model ?? capability.model ?? null;
  const model = input.runtime.resolveModelRef(modelRef) ?? input.runtime.resolveModelRef(null);
  const thinkingLevel =
    override.thinkingLevel ?? capability.thinkingLevel ?? input.runtime.getStatus().thinkingLevel;
  // 装配要等 loader 重建，而保存配置会在这期间换掉运行时：先把运行时取一次给本次装配用，
  // 免得出现「模型解析自旧运行时、交给新运行时建会话」的错配。
  // 这几行之间不得插入 await —— 同代快照靠「同一个同步块内不留让出点」保证
  const modelRuntime = input.runtime.requireRuntime();

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
    agentDir: input.harnessDir ?? env.harnessDir,
    modelRuntime,
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
      // 传全量：advertise 只决定是否写进描述，隐藏角色仍要进 `agent` 入参枚举
      ...(registry ? { subagentProfiles: allSubagents(registry) } : {}),
      memoryTools,
    }),
    resourceLoader: loader,
  };
};
