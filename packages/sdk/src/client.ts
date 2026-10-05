/**
 * 客户端：把接口层、事件流与各域同步状态装配成一个实例。
 *
 * 各端（web / 桌面 / TUI）创建一份实例；React 侧用 `useSyncExternalStore` 订阅各 store。
 * 无模块级单例，多窗口多实例互不干扰。
 */
import { type Apis, type ApisOptions, createApis } from "./apis";
import { createEventStream, type EventStream } from "./events";
import { createCommandsStore } from "./stores/commands";
import { createConfigStore } from "./stores/config";
import { createGoalStore } from "./stores/goal";
import { createHealthStore } from "./stores/health";
import { createInteractionsStore } from "./stores/interactions";
import { createMcpStore } from "./stores/mcp";
import { createMessagesStore } from "./stores/messages";
import { createModelsStore } from "./stores/models";
import { createSessionsStore } from "./stores/sessions";
import { createUsageStore } from "./stores/usage";

export type ClientOptions = ApisOptions;

export const createClient = (options: ClientOptions = {}) => {
  const apis: Apis = createApis(options);
  const events: EventStream = createEventStream(apis.events.stream);

  const sessions = createSessionsStore({ apis, events });
  const messages = createMessagesStore({ apis, events });
  const interactions = createInteractionsStore({ apis, events });
  const goal = createGoalStore({ apis, events });
  const models = createModelsStore({ apis, events });
  const health = createHealthStore({ apis, events });
  const commands = createCommandsStore({ apis });
  const usage = createUsageStore({ apis, events });
  const config = createConfigStore({ apis, events });
  const mcp = createMcpStore({ apis, events });

  return {
    apis,
    events,
    sessions,
    messages,
    interactions,
    goal,
    models,
    health,
    commands,
    usage,
    config,
    mcp,
  };
};

export type Client = ReturnType<typeof createClient>;
