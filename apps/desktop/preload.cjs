// preload：把宿主差异（本机能力）以最小面暴露给渲染进程。
//
// 渲染进程里跑的是**与 Web 壳同一份界面产物**（由服务同源发出），协议连接走 sdk 的
// HTTP 传输（端点由主进程经 `environment()` 给出）。因此这里不再有消息桥——
// preload 只负责浏览器给不了的那几件事：托盘相关能力、系统通知、OS 凭据、内置浏览器。
//
// **必须是 CommonJS**：Electron 的 preload 在沙箱里跑，不支持 ESM。

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  /** 主进程环境信息（产品名、数据根、服务端点）。 */
  environment: () => ipcRenderer.invoke("desktop:environment"),

  // ── 本机能力（F-5.4 / F-4.4 / F-2.9）：界面只拿到"动作"，实现与密钥都在主进程 ──

  /** 保持唤醒（F-4.4）：传 SDK 的 keepAwake，主进程据此阻止系统休眠。 */
  setKeepAwake: (enabled) => ipcRenderer.invoke("desktop:keep-awake", enabled === true),
  /** 系统通知；系统不支持时返回 false。 */
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload),
  /** OS 凭据存储（safeStorage 加密后落盘，明文不落盘）。 */
  credentials: {
    list: () => ipcRenderer.invoke("desktop:credential-list"),
    set: (name, value) => ipcRenderer.invoke("desktop:credential-set", name, value),
    get: (name) => ipcRenderer.invoke("desktop:credential-get", name),
    remove: (name) => ipcRenderer.invoke("desktop:credential-delete", name),
  },
  /** 内置浏览器（F-2.9）：开独立窗口加载 http(s) 地址。 */
  openBrowser: (url) => ipcRenderer.invoke("desktop:browser-open", url),
});
