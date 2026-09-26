// spike/fixtures/plugin-a.ts —— V-4 测试插件 A：注册工具、订阅事件、向事件总线发送
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

declare global {
  // eslint-disable-next-line no-var
  var __spikePluginA: { loaded: boolean; events: string[] } | undefined;
}

export default function (pi: ExtensionAPI) {
  (globalThis as any).__spikePluginA = { loaded: true, events: [] };
  const log = (s: string) => (globalThis as any).__spikePluginA.events.push(s);

  pi.registerTool(
    defineTool({
      name: "spike_echo",
      label: "Spike Echo",
      description: "Echo the given text back, prefixed with 'Processed:'",
      parameters: Type.Object({ input: Type.String({ description: "text to echo" }) }),
      async execute(_toolCallId, params) {
        log(`tool:execute:${params.input}`);
        return { content: [{ type: "text", text: `Processed: ${params.input}` }], details: {} };
      },
    }),
  );

  pi.on("tool_call", async (event: any) => {
    log(`tool_call:${event?.toolName ?? "?"}`);
    // 在确定会触发的事件里发总线消息，供 plugin-b 接收
    pi.events.emit("spike:ping", { from: "plugin-a", message: "hello-b" });
  });
  pi.on("session_start", async () => {
    log("session_start");
  });
}
