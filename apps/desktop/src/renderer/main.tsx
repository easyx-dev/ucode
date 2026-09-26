import { type Capability, connect } from "@ucode/sdk";
import { AgentShell, AgentStoreProvider, createAgentStore } from "@ucode/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createIpcTransport } from "./transport.ts";

/**
 * 桌面壳的渲染进程入口。
 *
 * 与 Web 壳**共用同一份 sdk 与 ui**（ADR-022）；差别只在传输——
 * 这里用 `window.desktopBridge`（IPC 桥到主进程 spawn 的核心层 stdio），Web 用 HTTP+SSE。
 * 主进程把核心层当作子进程持有，渲染进程不碰 Node API（contextIsolation 开着）。
 */

const capabilities: Capability[] = [
  "sessions.read",
  "sessions.write",
  "prompt.run",
  "interaction.respond",
  "autonomy.unattended",
  "channel.workspace",
];

const environment = await window.desktopBridge.environment();

const sdk = await connect({
  transport: createIpcTransport(),
  clientId: `desktop-${Math.random().toString(36).slice(2, 8)}`,
  clientKind: "desktop",
  capabilities,
  identity: { user: null, device: "desktop" },
});

try {
  await sdk.connect();
} catch (error) {
  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <div className="p-6 text-sm">
      连接核心层失败：{error instanceof Error ? error.message : String(error)}
    </div>,
  );
  throw error;
}

document.title = environment.productName;

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <AgentStoreProvider store={createAgentStore(sdk)}>
      <AgentShell productName={environment.productName} defaultCwd={environment.dataDir} />
    </AgentStoreProvider>
  </StrictMode>,
);
