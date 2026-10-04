/** 全局事件流的运行时转发：组件与 hooks 只订阅，不关心连接细节 */
import type { ServerEvent } from "@ucode/contracts";

import { getRuntime } from "../runtime";

export const eventStream = {
  start: (): void => getRuntime().sdk.events.start(),
  stop: (): void => getRuntime().sdk.events.stop(),
  subscribe: (listener: (frame: ServerEvent) => void): (() => void) =>
    getRuntime().sdk.events.subscribe(listener),
  onStatus: (listener: (connected: boolean) => void): (() => void) =>
    getRuntime().sdk.events.onStatus(listener),
};
