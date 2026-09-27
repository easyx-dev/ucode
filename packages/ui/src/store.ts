import type {
  AgentSdk,
  AutonomyLevel,
  CatalogEntry,
  InstalledResource,
  InstallResult,
  MarketplaceSource,
  MigrationPreflight,
  ProviderSummary,
  SdkState,
  SupportBundleResult,
  UsageSummary,
  WorkspaceGitChange,
  WorkspaceGitCommit,
  WorkspaceReadResult,
  WorkspaceTreeEntry,
} from "@ucode/sdk";
import { createStore, type StoreApi } from "zustand/vanilla";
import { composeFollowUpPrompt } from "./components/follow-up.ts";

/**
 * 视图模型（spec §7.1：`ui` = React 组件**与视图模型**）。
 *
 * 视图模型只做两件事：把 sdk 的状态镜像进来，把用户动作翻译成 sdk 调用。
 * 它**不认识协议细节**，也不认识宿主（浏览器 / Electron）——这正是 Web 与桌面能共用它的原因。
 */

/** 工作区面板的每会话状态（F-2.7/F-2.8）：树、变更、提交历史、当前预览的文件。 */
export type WorkspaceState = {
  tree: WorkspaceTreeEntry[];
  changes: WorkspaceGitChange[];
  commits: WorkspaceGitCommit[];
  hasMore: boolean;
  file: WorkspaceReadResult | null;
  loading: boolean;
  error: string | null;
};

export const emptyWorkspace = (): WorkspaceState => ({
  tree: [],
  changes: [],
  commits: [],
  hasMore: false,
  file: null,
  loading: false,
  error: null,
});

/** 插件市场面板状态（F-3.6）。 */
export type MarketplaceState = {
  sources: MarketplaceSource[];
  installed: InstalledResource[];
  /** 按源缓存的目录（点开源才读）。 */
  catalog: Record<string, CatalogEntry[]>;
  loading: boolean;
  error: string | null;
};

export const emptyMarketplace = (): MarketplaceState => ({
  sources: [],
  installed: [],
  catalog: {},
  loading: false,
  error: null,
});

/** 用量 / 支持包 / 迁移面板状态（F-5.6~5.8）。 */
export type InsightsState = {
  usage: UsageSummary | null;
  readable: string | null;
  /** 最近一次导出的包（路径与体积）。 */
  exported: SupportBundleResult | null;
  preflight: MigrationPreflight | null;
  note: string | null;
  loading: boolean;
  error: string | null;
};

export const emptyInsights = (): InsightsState => ({
  usage: null,
  readable: null,
  exported: null,
  preflight: null,
  note: null,
  loading: false,
  error: null,
});

/**
 * 模型配置状态（F-5.3）。
 *
 * 单独放一份而不是从 `sdk.state.models` 推：模型列表只有"可选模型"，
 * 而配置窗口要显示**供应商**（端点、有没有密钥、写进去的模型），
 * 并且要在新增/删除后立刻回读。密钥本身永远不出现在这里——协议只回报有/无。
 */
export type ProvidersState = {
  providers: ProviderSummary[];
  configFile: string | null;
  loading: boolean;
  error: string | null;
  /** 最近一次操作的结果提示（含"声明与解析不一致"的告警）。 */
  notice: string | null;
};

export const emptyProviders = (): ProvidersState => ({
  providers: [],
  configFile: null,
  loading: false,
  error: null,
  notice: null,
});

export type AgentStoreState = {
  sdk: AgentSdk;
  state: SdkState;
  /** 工作区面板状态，按会话隔离。 */
  workspace: Record<string, WorkspaceState>;
  /** 插件市场面板状态。 */
  marketplace: MarketplaceState;
  /** 用量 / 支持包 / 迁移面板状态。 */
  insights: InsightsState;
  /** 模型配置（供应商）状态。 */
  providers: ProvidersState;
  /** 输入框草稿（按会话隔离，切换会话不丢）。 */
  drafts: Record<string, string>;
  bootError: string | null;

  setDraft(sessionId: string, text: string): void;
  /** 划选追问（F-1.12）：把引用的内容填进输入框草稿，由用户补问题后发送。 */
  quoteIntoDraft(sessionId: string, selection: string): void;
  send(sessionId: string): Promise<void>;
  createSession(cwd?: string): Promise<string>;
  attachSession(sessionId: string): Promise<void>;
  setAutonomy(sessionId: string, level: AutonomyLevel): Promise<void>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  setModel(sessionId: string, provider: string, modelId: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  compact(sessionId: string): Promise<void>;
  renameSession(sessionId: string, name: string): Promise<void>;
  respond(interactionId: string, value: string | boolean | null, cancelled?: boolean): void;
  resolveInteraction(
    sessionId: string,
    interactionId: string,
    value: string | boolean | null,
    cancelled?: boolean,
  ): Promise<void>;
  forkSession(sessionId: string): Promise<string>;
  refresh(): Promise<void>;

  // 自动化任务（F-4.5 面板）
  loadTasks(): Promise<void>;
  createTask(input: {
    kind: "cron" | "idle";
    prompt: string;
    cron?: string;
    delayMinutes?: number;
    everyMinutes?: number;
    sessionId?: string | null;
    autonomy?: AutonomyLevel;
  }): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  toggleTask(taskId: string, status: string): Promise<void>;
  runTask(taskId: string): Promise<void>;

  // 用量 / 支持包 / 迁移（F-5.6~5.8）
  loadUsage(): Promise<void>;
  exportBundle(): Promise<void>;
  preflightMigration(from: string): Promise<void>;
  importData(from: string, onConflict?: "skip" | "overwrite"): Promise<void>;

  // 模型配置（F-5.3）：没有它，新用户只能看到空的模型列表
  loadProviders(): Promise<void>;
  /** 返回告警文案（`null` 表示与声明一致）；失败时把错误写进 `providers.error`。 */
  addProvider(input: {
    id: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    makeDefault?: boolean;
  }): Promise<string | null>;
  removeProvider(id: string): Promise<void>;

  // 插件市场（F-3.6）
  loadMarketplace(): Promise<void>;
  loadCatalog(source: string): Promise<void>;
  addMarketplaceSource(input: {
    name: string;
    kind: "local" | "remote";
    location: string;
    description?: string;
  }): Promise<void>;
  removeMarketplaceSource(name: string): Promise<void>;
  /** 返回安装报告（装了几个/跳过几个/失败几个），失败时返回 null。 */
  installPlugin(input: {
    source: string;
    plugin: string;
    overwrite?: boolean;
  }): Promise<InstallResult | null>;
  uninstallPlugin(input: {
    kind: "skill" | "prompt" | "agent" | "extension";
    name: string;
  }): Promise<void>;

  // 工作区（F-2.7/F-2.8）
  loadWorkspace(sessionId: string): Promise<void>;
  openFile(sessionId: string, path: string): Promise<void>;
  closeFile(sessionId: string): void;
};

export type AgentStore = StoreApi<AgentStoreState>;

export function createAgentStore(sdk: AgentSdk): AgentStore {
  const store = createStore<AgentStoreState>((set, get) => {
    const unsubscribe = sdk.subscribe((state) => set({ state }));
    void unsubscribe;

    const guard = async (action: () => Promise<void>): Promise<void> => {
      try {
        await action();
      } catch (error) {
        set({ bootError: error instanceof Error ? error.message : String(error) });
      }
    };

    const patchWorkspace = (sessionId: string, patch: Partial<WorkspaceState>): void => {
      const current = get().workspace[sessionId] ?? emptyWorkspace();
      set({ workspace: { ...get().workspace, [sessionId]: { ...current, ...patch } } });
    };

    const patchMarketplace = (patch: Partial<MarketplaceState>): void => {
      set({ marketplace: { ...get().marketplace, ...patch } });
    };

    const patchInsights = (patch: Partial<InsightsState>): void => {
      set({ insights: { ...get().insights, ...patch } });
    };

    const patchProviders = (patch: Partial<ProvidersState>): void => {
      set({ providers: { ...get().providers, ...patch } });
    };

    return {
      sdk,
      state: sdk.state,
      workspace: {},
      marketplace: emptyMarketplace(),
      insights: emptyInsights(),
      providers: emptyProviders(),
      drafts: {},
      bootError: null,

      setDraft(sessionId, text) {
        set({ drafts: { ...get().drafts, [sessionId]: text } });
      },

      quoteIntoDraft(sessionId, selection) {
        const existing = get().drafts[sessionId] ?? "";
        const question = existing.trim();
        set({
          drafts: { ...get().drafts, [sessionId]: composeFollowUpPrompt(selection, question) },
        });
      },

      async send(sessionId) {
        const text = (get().drafts[sessionId] ?? "").trim();
        if (text === "") return;
        set({ drafts: { ...get().drafts, [sessionId]: "" }, bootError: null });
        // 一律走 prompt：会话在跑时由服务层排进下一轮（`queued`），
        // 壳不再自己判断该 prompt 还是 steer——那会让两端行为不一致。
        await guard(async () => {
          await sdk.prompt(sessionId, text);
        });
      },

      async createSession(cwd) {
        const created = await sdk.createSession(cwd === undefined ? {} : { cwd });
        await sdk.attachSession(created.sessionId);
        await sdk.listSessions().catch(() => undefined);
        return created.sessionId;
      },

      async attachSession(sessionId) {
        await guard(async () => {
          await sdk.attachSession(sessionId);
          await sdk.getEntries(sessionId).catch(() => undefined);
        });
      },

      async setAutonomy(sessionId, level) {
        await guard(() => sdk.setAutonomy(sessionId, level));
      },

      async archiveSession(sessionId, archived) {
        await guard(() => sdk.archiveSession(sessionId, archived));
      },

      async setModel(sessionId, provider, modelId) {
        await guard(() => sdk.setModel(sessionId, provider, modelId));
      },

      async abort(sessionId) {
        await guard(() => sdk.abort(sessionId));
      },

      async compact(sessionId) {
        await guard(() => sdk.compact(sessionId));
      },

      async renameSession(sessionId, name) {
        await guard(() => sdk.setSessionName(sessionId, name));
      },

      respond(interactionId, value, cancelled = false) {
        sdk.respondToInteraction(interactionId, value, { cancelled });
      },

      async resolveInteraction(sessionId, interactionId, value, cancelled = false) {
        await guard(() => sdk.resolveInteraction(sessionId, interactionId, value, cancelled));
      },

      async forkSession(sessionId) {
        const created = await sdk.forkSession(sessionId);
        await sdk.attachSession(created.sessionId);
        await sdk.listSessions().catch(() => undefined);
        return created.sessionId;
      },

      async refresh() {
        await guard(async () => {
          await sdk.listSessions();
          await sdk.listModels();
          await sdk.taskList().catch(() => undefined);
          const active = get().state.activeSessionId;
          if (active !== null) await sdk.getEntries(active).catch(() => undefined);
        });
      },

      async loadTasks() {
        await guard(() => sdk.taskList().then(() => undefined));
      },

      async createTask(input) {
        const cwd = get().state.views[get().state.activeSessionId ?? ""]?.state?.cwd;
        await guard(() =>
          sdk.taskCreate({ ...input, ...(cwd === undefined ? {} : { cwd }) }).then(() => undefined),
        );
      },

      async cancelTask(taskId) {
        await guard(() => sdk.taskCancel(taskId));
      },

      async toggleTask(taskId, status) {
        await guard(() => (status === "active" ? sdk.taskPause(taskId) : sdk.taskResume(taskId)));
      },

      async runTask(taskId) {
        await guard(() => sdk.taskRun(taskId));
      },

      async loadWorkspace(sessionId) {
        patchWorkspace(sessionId, { loading: true, error: null });
        await guard(async () => {
          try {
            // 三个查询并发：面板打开时要一次到位，不该串行等三轮。
            const [tree, changes, log] = await Promise.all([
              sdk.workspaceTree(sessionId),
              sdk.workspaceGitChanges(sessionId),
              sdk.workspaceGitLog(sessionId, { limit: 30 }),
            ]);
            patchWorkspace(sessionId, {
              tree: tree.entries,
              changes: changes.changes,
              commits: log.commits,
              hasMore: log.hasMore,
              loading: false,
            });
          } catch (error) {
            patchWorkspace(sessionId, {
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async openFile(sessionId, path) {
        await guard(async () => {
          try {
            const file = await sdk.workspaceRead(sessionId, { path });
            patchWorkspace(sessionId, { file, error: null });
          } catch (error) {
            patchWorkspace(sessionId, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      closeFile(sessionId) {
        patchWorkspace(sessionId, { file: null });
      },

      async loadMarketplace() {
        patchMarketplace({ loading: true, error: null });
        await guard(async () => {
          try {
            const overview = await sdk.marketplaceOverview();
            patchMarketplace({
              sources: overview.sources,
              installed: overview.installed,
              loading: false,
            });
          } catch (error) {
            patchMarketplace({
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async loadCatalog(source) {
        await guard(async () => {
          try {
            const entries = await sdk.marketplaceCatalog(source);
            patchMarketplace({
              catalog: { ...get().marketplace.catalog, [source]: entries },
              error: null,
            });
          } catch (error) {
            patchMarketplace({
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async addMarketplaceSource(input) {
        await guard(async () => {
          await sdk.marketplaceAddSource(input);
          await get().loadMarketplace();
        });
      },

      async removeMarketplaceSource(name) {
        await guard(async () => {
          await sdk.marketplaceRemoveSource(name);
          await get().loadMarketplace();
        });
      },

      async installPlugin(input) {
        try {
          const report = await sdk.marketplaceInstall(input);
          // 装完刷新"已装"列表（面板立刻反映结果）。
          await get().loadMarketplace();
          return report;
        } catch (error) {
          set({
            bootError: error instanceof Error ? error.message : String(error),
            marketplace: {
              ...get().marketplace,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          return null;
        }
      },

      async uninstallPlugin(input) {
        await guard(async () => {
          await sdk.marketplaceUninstall(input);
          await get().loadMarketplace();
        });
      },

      async loadProviders() {
        patchProviders({ loading: true, error: null });
        await guard(async () => {
          try {
            const data = await sdk.listProviders();
            patchProviders({
              providers: data.providers,
              configFile: data.configFile,
              loading: false,
            });
          } catch (error) {
            patchProviders({
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async addProvider(input) {
        patchProviders({ loading: true, error: null, notice: null });
        let warning: string | null = null;
        await guard(async () => {
          try {
            const result = await sdk.addProvider({
              id: input.id,
              baseUrl: input.baseUrl,
              models: [{ id: input.model, name: input.model, input: ["text"] }],
              ...(input.apiKey === undefined || input.apiKey === ""
                ? {}
                : { apiKey: input.apiKey }),
              ...(input.makeDefault === undefined ? {} : { makeDefault: input.makeDefault }),
            });
            warning = result.warning;
            patchProviders({
              loading: false,
              notice:
                result.warning ??
                `已${result.created ? "添加" : "覆盖"}供应商 ${result.provider.id}`,
            });
            // 配置变了，模型列表也要跟着刷新——否则选择器里还是旧的。
            await sdk.listModels().catch(() => undefined);
            await get().loadProviders();
          } catch (error) {
            patchProviders({
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
        return warning;
      },

      async removeProvider(id) {
        patchProviders({ loading: true, error: null, notice: null });
        await guard(async () => {
          try {
            const result = await sdk.removeProvider(id);
            patchProviders({
              loading: false,
              notice: result.removed ? `已删除 ${id}` : `${id} 不存在`,
            });
            await sdk.listModels().catch(() => undefined);
            await get().loadProviders();
          } catch (error) {
            patchProviders({
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async loadUsage() {
        patchInsights({ loading: true, error: null });
        await guard(async () => {
          try {
            const data = await sdk.usageStats();
            patchInsights({ usage: data.summary, readable: data.readable, loading: false });
          } catch (error) {
            patchInsights({
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async exportBundle() {
        patchInsights({ loading: true, error: null, note: null });
        await guard(async () => {
          try {
            const bundle = await sdk.exportSupportBundle();
            patchInsights({
              exported: bundle,
              loading: false,
              note: `已导出 ${bundle.bytes} 字节（含：${bundle.included.join("、")}），密钥已脱敏。`,
            });
          } catch (error) {
            patchInsights({
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async preflightMigration(from) {
        patchInsights({ loading: true, error: null, note: null });
        await guard(async () => {
          try {
            const report = await sdk.migrationPreflight(from);
            patchInsights({ preflight: report, loading: false });
          } catch (error) {
            patchInsights({
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },

      async importData(from, onConflict) {
        await guard(async () => {
          const result = await sdk.migrationImport(
            from,
            onConflict === undefined ? {} : { onConflict },
          );
          patchInsights({
            note: `导入完成：新增 ${result.copied} 条，跳过 ${result.skipped} 条。`,
          });
          await get().loadUsage();
        });
      },
    };
  });

  return store;
}
