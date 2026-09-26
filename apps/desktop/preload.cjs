// preload：把"与核心层之间的传输"以最小面暴露给渲染进程。
//
// 渲染进程里跑的是和 Web 壳**同一份** sdk 与 ui（ADR-022）；差别只在传输——
// Web 用 HTTP+SSE，桌面用"IPC 桥到主进程 spawn 的核心层 stdio"。
// 这里只传消息，不做任何协议语义（绑定层只做序列化、寻址、流式，spec §5.1）。
//
// **必须是 CommonJS**：Electron 的 preload 在沙箱里跑，不支持 ESM。

const { contextBridge, ipcRenderer } = require("electron");

const messageHandlers = new Set();
const exitHandlers = new Set();

ipcRenderer.on("desktop:message", (_event, message) => {
  for (const handler of messageHandlers) handler(message);
});
ipcRenderer.on("desktop:core-exit", (_event, reason) => {
  for (const handler of exitHandlers) handler(reason);
});

contextBridge.exposeInMainWorld("desktopBridge", {
  /** 发一条协议 C 消息（经主进程写到核心层的 stdin）。 */
  send: (message) => {
    ipcRenderer.send("desktop:send", message);
  },
  /** 收一条核心层消息（主进程从 stdout 按字节切行后解析）。 */
  onMessage: (handler) => {
    messageHandlers.add(handler);
    return () => messageHandlers.delete(handler);
  },
  /** 核心层进程退出。 */
  onCoreExit: (handler) => {
    exitHandlers.add(handler);
    return () => exitHandlers.delete(handler);
  },
  /** 主进程环境信息（产品名、数据层目录）。 */
  environment: () => ipcRenderer.invoke("desktop:environment"),
});
