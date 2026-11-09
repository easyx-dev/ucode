/**
 * 客户端：把接口层、事件流与各域同步状态装配成一个实例。
 *
 * 各端（web / 桌面 / TUI）创建一份实例；React 侧用 `useSyncExternalStore` 订阅各 store。
 * 无模块级单例，多窗口多实例互不干扰。
 */
import { type Apis, type ApisOptions, createApis } from "./apis";
import { createEventStream, type EventStream } from "./events";
import { createAssetsStore } from "./stores/assets";
import { createAuthStore } from "./stores/auth";
import { createCommandsStore } from "./stores/commands";
import { createConfigStore } from "./stores/config";
import { createGoalStore } from "./stores/goal";
import { createHubStore } from "./stores/hub";
import { createInteractionsStore } from "./stores/interactions";
import { createMcpStore } from "./stores/mcp";
import { createMessagesStore } from "./stores/messages";
import { createModelsStore } from "./stores/models";
import { createPluginUiStore } from "./stores/plugin-ui";
import { createPluginsStore } from "./stores/plugins";
import { createProjectsStore } from "./stores/projects";
import { createSessionsStore } from "./stores/sessions";
import { createStatusStore } from "./stores/status";
import { createUsageStore } from "./stores/usage";

export type ClientOptions = ApisOptions;

export const createClient = (options: ClientOptions = {}) => {
  // 传输层 401 需要通知 auth store，但 transport 先于 store 创建：用一个可后置赋值的回调桥接
  let onUnauthorized: (() => void) | null = null;
  const apis: Apis = createApis({ ...options, onUnauthorized: () => onUnauthorized?.() });
  const events: EventStream = createEventStream(apis.events.stream);

  const auth = createAuthStore({ apis });
  onUnauthorized = () => auth.markAnonymous();

  const assets = createAssetsStore({ apis });
  const sessions = createSessionsStore({ apis, events });
  const messages = createMessagesStore({ apis, events });
  const interactions = createInteractionsStore({ apis, events });
  const goal = createGoalStore({ apis, events });
  const models = createModelsStore({ apis, events });
  const status = createStatusStore({ apis, events });
  const hub = createHubStore({ apis });
  const commands = createCommandsStore({ apis });
  const usage = createUsageStore({ apis, events });
  const config = createConfigStore({ apis, events });
  const mcp = createMcpStore({ apis, events });
  const projects = createProjectsStore({ apis, events });
  const plugins = createPluginsStore({ apis, events });
  const pluginUi = createPluginUiStore({ apis, events });

  return {
    apis,
    events,
    auth,
    assets,
    sessions,
    messages,
    interactions,
    goal,
    models,
    status,
    hub,
    commands,
    usage,
    config,
    mcp,
    projects,
    plugins,
    pluginUi,
  };
};

export type Client = ReturnType<typeof createClient>;
