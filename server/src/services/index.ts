/** 服务装配：把仓储、运行时、会话池与各领域服务装成 routes 依赖的 Services 容器 */
import type { AppConfigPatchInput } from "@ucode/contracts";
import { INTERACTION_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { ConfigStore } from "../config/store";
import { SessionEventBus } from "../core/event-bus";
import { InteractionBroker } from "../core/interactions";
import { SessionPool } from "../core/pool";
import { resolveSessionCwd } from "../core/session-paths";
import { openDatabase } from "../db";
import { AttachmentRepository } from "../db/attachment-repository";
import { AuthSessionRepository } from "../db/auth-session-repository";
import { ProjectRepository } from "../db/project-repository";
import { SessionRepository } from "../db/session-repository";
import { env } from "../env";
import { materializeAttachment } from "../harness/features/attachment";
import { GoalService } from "../harness/features/goal";
import { MemoryService } from "../harness/features/memory";
import { TitleService } from "../harness/features/title";
import { UsageService } from "../harness/features/usage";
import { appendSessionRecord } from "../harness/pi/records";
import { PiRuntime } from "../harness/pi/runtime";
import { materializeBuiltinAssets } from "../harness/plugins/builtin/materialize";
import { hasPrimaryMode, loadAgentRegistry } from "../harness/setup/agents";
import { contextBudgetOf } from "../harness/setup/budget";
import { SessionAllowStore } from "../harness/setup/permissions";
import { logger } from "../platform/logger";
import type { ServiceRegistration } from "../platform/service-registration";
import { CredentialStore } from "./auth/credentials";
import { PairingStore } from "./auth/pairing";
import { RateLimiter } from "./auth/rate-limit";
import { SessionService } from "./auth/sessions";
import { type BrowserService, createBrowserService } from "./browser";
import { createConfigService } from "./config";
import { createLifecycle } from "./lifecycle";
import { createPluginService, type PluginService, PluginStateStore } from "./plugins";
import { createMarketplaceService, type MarketplaceService } from "./plugins/marketplace";
import { ProjectService } from "./projects";
import { createTerminalService, type TerminalService } from "./terminal";

export type Services = {
  config: ConfigStore;
  /** 会话元数据与索引（SQLite） */
  sessions: SessionRepository;
  /** 附件元数据（SQLite）；字节在 `$APP_HOME/app/attachments` */
  attachments: AttachmentRepository;
  /** 项目偏好：按 cwd 归口的展示名与最近的会话参数 */
  projects: ProjectService;
  runtime: PiRuntime;
  pool: SessionPool;
  /** 会话事件总线：/events 的唯一数据源 */
  events: SessionEventBus;
  /** 交互中转：权限审批等「服务端提问、前端回答」的挂起请求 */
  interactions: InteractionBroker;
  /** 会话级权限状态：审批弹窗里的「本会话恒允」 */
  permissions: SessionAllowStore;
  /** 使用统计：从会话记录聚合 token 用量，不落库 */
  usage: UsageService;
  /** 目标模式：会话目标状态与落定后的校验续跑 */
  goals: GoalService;
  /** 会话标题：首条消息得到回复后自动起名 */
  titles: TitleService;
  /** 鉴权：凭证、登录会话、一次性配对码与登录限流 */
  auth: {
    credentials: CredentialStore;
    sessions: SessionService;
    pairing: PairingStore;
    loginLimiter: RateLimiter;
    /** 服务注册信息（host / port 等）；端口自选时 index 会在监听后回写同一个对象 */
    registration: ServiceRegistration;
  };
  /** 更新配置：落盘 + 按需重建 ModelRuntime，并把内存会话回收成「下次访问按新配置重装」 */
  applyConfig(patch: AppConfigPatchInput): Promise<void>;
  /** 插件登记表：安装 / 启停 / 卸载 / 重拉，落 `$APP_HOME/app/plugins.json` */
  plugins: PluginService;
  /** 插件市场来源：登记 / 移除 / 刷新 */
  marketplaces: MarketplaceService;
  /** 终端：按工作目录归口的 PTY 池（只在进程内存，不落库） */
  terminals: TerminalService;
  /** 浏览器：实例注册表与 profile 数据面（数据落在 `$APP_HOME/app/browser`） */
  browsers: BrowserService;
  /** 用当前配置重建运行时（手动刷新模型目录） */
  reload(): Promise<void>;
  /** 关闭共享的 SQLite 连接 */
  close(): void;
};

export const createServices = async (registration: ServiceRegistration): Promise<Services> => {
  // 单进程单连接：几个仓储共用同一个句柄，关闭也由这里统一负责
  const db = openDatabase();
  const config = new ConfigStore();
  const sessions = new SessionRepository(db);
  const attachments = new AttachmentRepository(db);
  const authSessions = new SessionService(new AuthSessionRepository(db));
  const credentials = new CredentialStore(registration, env.servicePath);
  const pairing = new PairingStore();
  const loginLimiter = new RateLimiter();
  const runtime = new PiRuntime();
  // 内置资产物化早于第一次装配与 `/` 菜单列举；失败只记诊断，不让服务起不来
  const builtin = materializeBuiltinAssets({ builtinDir: env.builtinDir });
  for (const message of builtin.diagnostics) {
    logger.warn({ message, module: "plugins.builtin" }, "内置资产物化有诊断");
  }
  const events = new SessionEventBus({
    // 实时帧里的图片当场落库：工具刚截的图不落，界面在刷新前一直取不到字节
    writeImage: (bytes, mimeType) =>
      materializeAttachment(bytes, mimeType, { repo: attachments }).id,
  });
  const projects = new ProjectService({
    repository: new ProjectRepository(db),
    isModelUsable: (ref) => Boolean(runtime.resolveModelRef(ref)),
    // 自定义 primary 角色随项目目录走，故可用性判定要按该项目的 cwd 读一次角色注册表
    hasMode: (cwd, mode) => hasPrimaryMode(mode, loadAgentRegistry({ cwd, appHome: env.homeDir })),
    // 改名与写回默认值都广播：写回是「在会话里改了参数」的副作用，各端手上的项目行要跟上
    onChange: (list) =>
      events.emitControl({
        type: "projects_changed",
        projects: { projects: list, total: list.length },
      }),
    /*
      记忆开关在会话装配时读入（与全局开关同一条路径），改完要让已建好的会话按新值重装：
      空闲实例直接丢掉、等审批 / 等计划确认的只标脏（见 `pool.recycleForConfigChange`）。
      池在下面才建，回调用到时现取。
     */
    onMemoryChange: () => pool.recycleForConfigChange(),
  });
  // 池在这里之后才建，回调用到时现取（挂起的交互只存在于正在跑的会话上）
  const interactions = new InteractionBroker(events, ({ sessionId, request, outcome }) => {
    const record = sessions.find(sessionId);
    const live = pool.get(sessionId)?.sessionManager;
    const payload = {
      kind: request.kind,
      requestId: request.requestId,
      outcome,
      ...("sourceSessionId" in request ? { sourceSessionId: request.sourceSessionId } : {}),
      at: new Date().toISOString(),
    };
    // 两种去向都没有（会话行不存在且池里没有活会话）时什么都不写：挂起的交互只存在于正在跑的会话上
    if (live) {
      appendSessionRecord(record, INTERACTION_RECORD_CUSTOM_TYPE, payload, { live });
    } else if (record) {
      appendSessionRecord(record, INTERACTION_RECORD_CUSTOM_TYPE, payload, {
        cwd: resolveSessionCwd(record),
      });
    }
  });
  const permissions = new SessionAllowStore();
  const usage = new UsageService(
    sessions,
    (ref) => runtime.contextWindowOf(ref),
    // 触发点与装配层注入 pi 的阈值同源：界面显示的「预算」就是实际会压缩的那个数
    (ref) => {
      const contextWindow = runtime.contextWindowOf(ref);
      if (!contextWindow) return null;
      return contextBudgetOf({
        contextWindow,
        override: runtime.contextBudgetOf(ref),
      }).triggerTokens;
    },
  );
  const memory = new MemoryService(
    () => config.get().memory,
    env.appDir,
    // 项目级覆盖：与全局开关同一处收口，装配期按会话 cwd 求值
    (cwd) => projects.memoryOverrideOf(cwd),
  );
  const goals = new GoalService(sessions, usage, events);
  // 插件在池之前建：池的装配需要它的资产目录；而它的变更回收又用回池，两边都是延迟取值
  const pluginState = new PluginStateStore();
  pluginState.load();
  const pluginDeps = {
    state: pluginState,
    events,
    onRegistryChange: (revision: number) => pool.recycleForPluginChange(revision),
  };
  const plugins = createPluginService(pluginDeps);
  const marketplaces = createMarketplaceService({
    ...pluginDeps,
    onCatalogRefreshed: () => plugins.checkUpdates(),
    pluginList: () => plugins.list(),
  });
  const browsers = createBrowserService();
  const pool = new SessionPool(
    runtime,
    sessions,
    events,
    () => config.get().websearch,
    {
      allow: permissions,
      interactions,
    },
    memory,
    goals,
    usage,
    browsers.hooks,
    () => config.get().browser,
    {
      commandAssets: (cwd) => plugins.commandAssets(cwd),
      agents: (cwd) => plugins.agentProfiles(cwd),
      extensionPaths: (cwd) => plugins.extensionPaths(cwd),
      binDirs: (cwd) => plugins.binDirs(cwd),
      hooks: (cwd) => plugins.hooks(cwd),
      mcpServers: (cwd) => plugins.mcpServers(cwd),
    },
  );
  // 标题在池之后装配：它订阅总线的 `agent_settled`，并借池拿到池内会话
  const titles = new TitleService({
    sessions,
    events,
    liveOf: (sessionId) => pool.get(sessionId),
    emitSummary: (sessionId) => pool.refreshSummary(sessionId),
  });

  const lifecycle = createLifecycle({
    db,
    config,
    runtime,
    pool,
    sessions,
    attachments,
    projects,
    auth: { sessions: authSessions, pairing, loginLimiter },
  });
  const configService = createConfigService({ config, runtime, pool, events });
  // 终端排在会话池之后：它只用到会话仓储（据此把 sessionId 解析成工作目录）
  const terminals = createTerminalService({ sessions });

  await lifecycle.start();

  return {
    config,
    sessions,
    attachments,
    projects,
    runtime,
    pool,
    events,
    interactions,
    permissions,
    usage,
    goals,
    titles,
    plugins,
    marketplaces,
    terminals,
    browsers,
    auth: {
      credentials,
      sessions: authSessions,
      pairing,
      loginLimiter,
      registration,
    },
    applyConfig: configService.applyConfig,
    reload: configService.reload,
    close: () => {
      // 终端与浏览器进程都不归会话池管（也不随会话回收），服务退出时在这里一并清掉
      terminals.disposeAll();
      browsers.disposeAll();
      lifecycle.stop();
    },
  };
};
