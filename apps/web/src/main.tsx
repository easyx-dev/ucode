import { getBrand } from "@ucode/branding";
import { type Capability, connect } from "@ucode/sdk";
import { createClient } from "@ucode/sdk/http";
import { AgentShell, AgentStoreProvider, createAgentStore } from "@ucode/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/**
 * Web 壳入口（**桌面壳复用同一份产物**：Electron 从服务的 HTTP 端点加载它）。
 *
 * 与服务层同源（由服务把静态资源发出去），因此：
 * - 直接用 `location.origin` 连，没有 CORS、没有跨站 cookie 问题；
 * - 传输是 HTTP + SSE（下行推、上行 POST），断线由 sdk 自动带游标续传。
 *
 * 宿主差异只有一处：Electron 里 preload 会暴露 `desktopBridge`（系统通知、OS 凭据、
 * 保持唤醒、内置浏览器）。浏览器里它不存在，因此全部按可选处理。
 */

/** 桌面宿主（Electron）经 preload 暴露的本机能力。 */
type DesktopBridge = {
  setKeepAwake?(enabled: boolean): Promise<boolean>;
};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}
const brand = getBrand();

const capabilities: Capability[] = [
  "sessions.read",
  "sessions.write",
  "prompt.run",
  "interaction.respond",
  "channel.workspace",
];

const clientId = (() => {
  const existing = globalThis.localStorage?.getItem("clientId");
  if (existing !== null && existing !== undefined && existing !== "") return existing;
  const created = `web-${Math.random().toString(36).slice(2, 10)}`;
  globalThis.localStorage?.setItem("clientId", created);
  return created;
})();

const transport = createClient({
  baseUrl: globalThis.location.origin,
  clientId,
});

const sdk = await connect({
  transport,
  clientId,
  clientKind: "web",
  capabilities,
});

const root = createRoot(document.getElementById("root") as HTMLElement);

try {
  await sdk.connect();
} catch (error) {
  root.render(
    <div className="p-6 text-sm text-[var(--color-danger)]">
      连接服务层失败：{error instanceof Error ? error.message : String(error)}
      <p className="mt-2 text-[var(--color-content-muted)]">
        请确认是通过 `{brand.productName} web` 打开的页面（页面与服务层必须同源）。
      </p>
    </div>,
  );
  throw error;
}

document.title = brand.productName;

// 保持唤醒（桌面壳）：服务层在状态里给出 keepAwake，主进程据此阻止系统休眠。
// 只在**变化时**发一次 IPC，避免每次状态更新都打扰主进程；浏览器里没有这条通路。
let lastKeepAwake: boolean | null = null;
sdk.subscribe((state) => {
  if (state.keepAwake === lastKeepAwake) return;
  lastKeepAwake = state.keepAwake;
  void globalThis.window?.desktopBridge?.setKeepAwake?.(state.keepAwake);
});

root.render(
  <StrictMode>
    <AgentStoreProvider store={createAgentStore(sdk)}>
      <AgentShell productName={brand.productName} />
    </AgentStoreProvider>
  </StrictMode>,
);
