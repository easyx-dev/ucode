// spike/fixtures/plugin-b.ts —— V-4 测试插件 B：只订阅事件总线，验证跨插件通信
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

declare global {
  // eslint-disable-next-line no-var
  var __spikePluginB: { loaded: boolean; received: unknown[] } | undefined;
}

export default function (pi: ExtensionAPI) {
  (globalThis as any).__spikePluginB = { loaded: true, received: [] };
  pi.events.on("spike:ping", (data) => {
    (globalThis as any).__spikePluginB.received.push(data);
  });
}
