import type { Transport } from "@ucode/sdk";

/**
 * 桌面壳的传输：`window.desktopBridge`（preload 暴露的 IPC 桥）。
 *
 * 与 `@ucode/binding-stdio/client` 的差别只在"线在哪里"——
 * 桌面壳里核心层是**主进程的子进程**，渲染进程与它之间隔着 IPC；
 * 分帧与解析在主进程做（那里才碰得到子进程的 stdout 字节流），
 * 渲染进程收发的已经是解析好的 JSON 值（结构化克隆，无需转义担心）。
 */

type DesktopBridge = {
  send(message: unknown): void;
  onMessage(handler: (raw: unknown) => void): () => void;
  onCoreExit(handler: (reason: string) => void): () => void;
  environment(): Promise<{ productName: string; dataDir: string }>;
  /** 本机能力（F-5.4/F-4.4/F-2.9）；Web 宿主没有这些，因此可选。 */
  setKeepAwake?(enabled: boolean): Promise<boolean>;
  notify?(payload: { title?: string; body?: string }): Promise<boolean>;
  credentials?: {
    list(): Promise<string[]>;
    set(name: string, value: string): Promise<boolean>;
    get(name: string): Promise<string | null>;
    remove(name: string): Promise<boolean>;
  };
  openBrowser?(url: string): Promise<boolean>;
};

declare global {
  interface Window {
    desktopBridge: DesktopBridge;
  }
}

export function createIpcTransport(): Transport {
  const bridge: DesktopBridge = window.desktopBridge;
  const closeHandlers: ((reason?: string) => void)[] = [];

  return {
    kind: "stdio",
    send(message) {
      bridge.send(message);
    },
    onMessage(handler) {
      bridge.onMessage(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
      bridge.onCoreExit((reason) => handler(reason));
    },
    onError() {
      // IPC 桥上没有独立的错误通道：核心层退出会走 onCoreExit
    },
    async close() {
      // 传输由主进程持有（核心层是它的子进程）；渲染进程不主动关停
      closeHandlers.length = 0;
    },
    ready: async () => {
      await bridge.environment();
    },
  };
}
