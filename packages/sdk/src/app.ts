/**
 * SDK 组合入口：把无状态的接口客户端、全局事件流与各状态 store 装配在一起。
 *
 * 各端（web / Electron / TUI）创建一份实例；React 侧用 `useSyncExternalStore` 订阅 store。
 */
import { type ClientOptions, createClient, type UcodeClient } from "./client";
import { createEventStream, type EventStream } from "./events";
import { createSessionStreams, type SessionStreams } from "./stream/session";

export type SdkOptions = ClientOptions;

export const createSdk = (options: SdkOptions = {}) => {
  const client: UcodeClient = createClient(options);
  const events: EventStream = createEventStream(client.events.subscribe);
  const sessionStream: SessionStreams = createSessionStreams({
    client,
    events,
    translate: options.translate,
  });

  return { client, events, sessionStream };
};

export type Sdk = ReturnType<typeof createSdk>;
