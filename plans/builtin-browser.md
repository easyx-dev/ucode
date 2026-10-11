# 桌面端内置浏览器（含 agent 驱动）

> 状态：**未实现，仅设计**。先落地的是工作台的前两个标签（见
> [`workbench-panel.md`](./workbench-panel.md)）；本方案等那部分稳定后再启动。
> 参考形态：ZCode 的「浏览器面板」（仅桌面端，带地址栏与前进后退、agent 可驱动）、
> VS Code 的集成浏览器、opencode 的 desktop integrated browser 提案。

## 目标

1. **自己用**：应用内直接打开本地开发地址或线上页面，不必切到外部浏览器。
   地址栏 + 前进 / 后退 / 刷新 / 停止 / 开发者工具，支持 `http` / `https` / `file`。
2. **agent 用**：模型能开页、点击、填表、滚动、截图、读可见文本，用它自己验证前端改动。

## 为什么只能做在桌面端

- 真浏览器需要一个**独立的渲染进程与视图层**：Electron 的 `WebContentsView` 可以嵌进窗口，
  且与主渲染层进程隔离；web 端只能用 iframe，绝大多数站点会因 `X-Frame-Options` / CSP 拒绝。
- 截图（`capturePage`）、独立 session（cookie / 缓存隔离）、开发者工具都只有主进程能做。

## 视图层（阶段 1：手动浏览）

主进程维护 `tabId → WebContentsView` 的池：

- `session.fromPartition("persist:ucode-browser")` 单独一个 partition。
  **这一点很关键**：服务凭证的注入注册在 `session.defaultSession.webRequest`
  （`apps/desktop/src/main/index.ts`），独立 partition 天然不继承它，
  于是浏览器访问本机服务时不会被带上 `Authorization: Bearer`。
- `setWindowOpenHandler` → 拦截为同一面板内的新标签（不让系统浏览器接管）；
  `setPermissionRequestHandler` → 默认拒绝（摄像头 / 麦克风 / 地理位置 / 通知）；
  补 `will-navigate` 守卫与 `render-process-gone` 兜底。
- IPC 通道 `desktop:browser:*`（沿用现有 `ipcMain.handle` + `ipcRenderer.invoke` 风格）：
  `create` / `navigate` / `back` / `forward` / `reload` / `stop` / `close` / `setBounds` /
  `setVisible` / `devTools`，事件（`did-navigate` / `did-start-loading` / `page-title-updated` /
  `did-fail-load` / `new-window`）经 `desktop:browser:event` 推回渲染层。
- 跨进程类型放 `apps/desktop/src/shared/browser.ts`（与 `shared/connection.ts` 同口径）。

渲染层：

- `packages/ui` 定义 `BrowserBridge` 接口（不引 Electron 类型），由
  `apps/desktop/src/renderer/lib/browser-bridge.ts` 适配 `window.desktop.browser` 后注入。
  web 端传 `null`，「浏览器」标签不出现——能力决定标签，而不是靠环境判断。
- 容器 `getBoundingClientRect()` 经 `ResizeObserver` + window resize（rAF 节流）上报 bounds；
  Electron 的 `setBounds` 单位与 CSS px 在 `zoomFactor = 1` 下一致，缩放因子留注释。
- **遮挡问题**：`WebContentsView` 永远绘制在窗口的 web contents **之上**，任何弹层都会被它盖住。
  处理办法是让视图的可见性同时取决于「当前是浏览器标签」与「没有浮层打开」：
  新增 `packages/ui/src/lib/overlay-lock.ts`（模块级计数 + 订阅），在
  `base/{dialog,sheet,dropdown-menu,select}` 与 sonner 的 open 状态变化时增减计数。

## agent 驱动（阶段 2）

服务端不直接控制 Electron，而是复用「服务端提问、客户端回答」的既有原语
（`core/interactions` 的 `InteractionBroker` 形态）：

1. 服务端新增 `core/browser-bridge.ts`：按 `requestId` 挂起 Promise，向事件流发
   `browser_request` 会话帧（载荷为动作 + 参数），收到 `browser/respond` 即结算；
   支持 abort 结算与 `forget(sessionId)`，与审批 / 提问一致。
2. 桌面端渲染层订阅该帧 → 经 `BrowserBridge` 执行 → `POST /api/v1/browser/respond` 回传结果。
   收到请求时自动展开面板并切到浏览器标签（ZCode 行为）。
3. 工具集（`harness/setup/tools/browser/`）：`browser_open` / `browser_snapshot`（可交互元素摘要，
   让模型少猜选择器）/ `browser_click` / `browser_type` / `browser_press` / `browser_scroll` /
   `browser_screenshot` / `browser_history` / `browser_tabs` / `browser_close`。
   截图由主进程 `capturePage()` → base64 → 渲染层上传 attachments → 应答带 `attachmentId`
   → 服务端转 image block 交回模型（复用现有附件存储与序列化）。
4. 在线判定：桌面端 `createClient` 时带 `headers: { "x-ucode-capabilities": "browser" }`
   （`TransportOptions.headers` 已支持，事件流是 POST stream 也带得上），
   服务端在 events 连接 / 断开时维护计数。**没有 host 在线时工具立即报错**
   （「内置浏览器仅在桌面端可用」），不干等超时。
5. 权限：`browser_*` 默认 `ask`（对象取目标 host，可选「本会话恒允」），
   与 bash / webfetch 同一套审批链路；提示词补一段用法说明（先 snapshot 再操作、
   用截图确认视觉结果、本地起服务后用 `http://127.0.0.1:<port>`）。

## 不做

- 下载管理（交给系统浏览器 / `shell.openExternal`）、书签、历史记录、扩展。
- 多窗口（浏览器视图固定在主窗口内）。
- web 端的浏览器能力（iframe 不可靠，明确不做）。
