import type { AgentSdk, AutonomyLevel, SdkState } from "@ucode/sdk";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * 视图模型（spec §7.1：`ui` = React 组件**与视图模型**）。
 *
 * 视图模型只做两件事：把 sdk 的状态镜像进来，把用户动作翻译成 sdk 调用。
 * 它**不认识协议细节**，也不认识宿主（浏览器 / Electron）——这正是 Web 与桌面能共用它的原因。
 */

export type AgentStoreState = {
  sdk: AgentSdk;
  state: SdkState;
  /** 输入框草稿（按会话隔离，切换会话不丢）。 */
  drafts: Record<string, string>;
  bootError: string | null;

  setDraft(sessionId: string, text: string): void;
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

    return {
      sdk,
      state: sdk.state,
      drafts: {},
      bootError: null,

      setDraft(sessionId, text) {
        set({ drafts: { ...get().drafts, [sessionId]: text } });
      },

      async send(sessionId) {
        const text = (get().drafts[sessionId] ?? "").trim();
        if (text === "") return;
        set({ drafts: { ...get().drafts, [sessionId]: "" }, bootError: null });
        const view = get().state.views[sessionId];
        await guard(async () => {
          if (view?.running === true) await sdk.steer(sessionId, text);
          else await sdk.prompt(sessionId, text);
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
          const active = get().state.activeSessionId;
          if (active !== null) await sdk.getEntries(active).catch(() => undefined);
        });
      },
    };
  });

  return store;
}
