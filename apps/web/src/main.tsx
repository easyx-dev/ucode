import { getBrand } from "@ucode/branding";
import { type Capability, connect } from "@ucode/sdk";
import { createClient } from "@ucode/sdk/http";
import { AgentShell, AgentStoreProvider, createAgentStore } from "@ucode/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/**
 * Web 壳入口。
 *
 * 与核心层同源（由 CLI 的 web 子命令在同一端口发布），因此：
 * - 直接用 `location.origin` 连，没有 CORS、没有跨站 cookie 问题；
 * - 传输是 HTTP + SSE（下行推、上行 POST），断线由 sdk 自动带游标续传。
 */
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
      连接核心层失败：{error instanceof Error ? error.message : String(error)}
      <p className="mt-2 text-[var(--color-content-muted)]">
        请确认是通过 `{brand.productName} web` 打开的页面（页面与核心层必须同源）。
      </p>
    </div>,
  );
  throw error;
}

document.title = brand.productName;

root.render(
  <StrictMode>
    <AgentStoreProvider store={createAgentStore(sdk)}>
      <AgentShell productName={brand.productName} />
    </AgentStoreProvider>
  </StrictMode>,
);
