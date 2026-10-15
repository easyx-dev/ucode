/**
 * Electron 主进程：窗口生命周期、渲染层协议、连接与系统通知的 IPC。
 *
 * 只连本机已运行的服务：从 `$APP_HOME/app/service.json` 读端点与 `serviceToken`，由主进程转给渲染层
 * （生产走 `app://` 协议处理器、开发走 Vite 代理并在请求头加 Bearer，见 `proxy.ts`）——
 * 渲染层与接口同源，因此没有跨域，凭证也不进渲染层；未运行 / 凭证失效时由渲染层给出可读提示。
 */
import { resolve } from "node:path";

import { brand } from "@ucode/brand/values";
import { app, BrowserWindow, ipcMain, session } from "electron";

import { isFrameless } from "../shared/chrome.ts";
import { isDevLaunch, RENDERER_DEV_URL } from "../shared/renderer.ts";
import {
  registerBrowserChannelIpc,
  registerBrowserGuest,
  unregisterBrowserGuest,
} from "./browser-channel.ts";
import { readServiceConnection, serviceFilePath } from "./connection.ts";
import { registerNotificationIpc } from "./notification.ts";
import { installRendererProtocol, RENDERER_ORIGIN, registerRendererScheme } from "./proxy.ts";
import { registerWindowControlsIpc, watchWindowState } from "./window-controls.ts";

/**
 * 开发形态（`electron . --dev`）由 Vite dev server 提供界面，否则加载盘上的构建产物。
 * 两个来源不会同时用：起了 dev server 就不读盘上的产物，避免跑着旧界面却以为在看新代码。
 */
const rendererDevUrl = isDevLaunch(process.argv) ? RENDERER_DEV_URL : undefined;
const rendererDist = resolve(import.meta.dirname, "../dist");

/**
 * Windows 靠 AppUserModelID 把 toast 归到应用名下，没设会被系统静默丢弃（通知等于发不出去）；
 * macOS 与 Linux 没有这个概念，调用是空操作。
 */
app.setAppUserModelId(`${brand.slug}.desktop`);

/**
 * 开发形态的令牌注入：渲染层由 Vite（`:5174`）提供、`/api/*` 经 Vite 代理转给服务，
 * 这条路不经过 `app://` 处理器，只能在这里加头。生产形态由处理器加，不需要这个监听。
 */
const installDevAuthInjection = (origin: string, token: string): void => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/api/*`] },
    (details, callback) => {
      callback({
        requestHeaders: { ...details.requestHeaders, Authorization: `Bearer ${token}` },
      });
    },
  );
};

/**
 * 每次渲染层取连接时重装注入：服务可能晚于窗口就绪、或重启后换了 token。
 * 只在启动时装一次的话，「先开桌面端、后起服务」以及刷新窗口都拿不到授权，只能重启应用。
 * `onBeforeSendHeaders` 重复注册会替换旧监听，不会叠加。
 */
const refreshDevAuthInjection = (): void => {
  if (!rendererDevUrl) return;
  const service = readServiceConnection();
  if (service) installDevAuthInjection(rendererDevUrl, service.token);
};

/** 开发时渲染层的 Vite 服务可能晚于 electron 就绪，重试到可用为止 */
const loadRenderer = async (window: BrowserWindow, url: string): Promise<void> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await window.loadURL(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
};

/**
 * 开发形态把 DevTools 放出来：加载完就独立开窗，⌘⌥I（Windows / Linux 也认 F12）随时收回或再唤出。
 * 只在开发形态装：生产跑的是构建产物，不需要也不该默认多一个窗口。
 */
const installDevTools = (window: BrowserWindow): void => {
  window.webContents.on("did-finish-load", () =>
    window.webContents.openDevTools({ mode: "detach" }),
  );
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    // 用 `code` 而不是 `key`：macOS 上 ⌥I 会产出死键字符，`key` 拿不到 "i"
    const shortcut = (input.meta || input.control) && input.alt && input.code === "KeyI";
    if (!shortcut && input.code !== "F12") return;
    event.preventDefault();
    window.webContents.toggleDevTools();
  });
};

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 600,
    show: false,
    /*
      自绘的窗口控件与标题条要在失焦时也一次点得动：macOS 默认会吃掉未聚焦窗口的第一次点击。
      同时把窗口做成透明的：界面的外壳与侧栏是玻璃层（`--glass` + `backdrop-blur`），
      要透出桌面与系统材质，得先有「能透的窗口」——否则玻璃后面永远是自己那层不透明的底色。
      `backgroundColor` 必须显式留空，否则首帧会先刷一层白再被材质盖掉（一闪）。
      非 macOS 不设：transparent 在那里要配合无边框窗口，而本壳只在 macOS 走自绘标题条。
    */
    ...(isFrameless(process.platform)
      ? {
          titleBarStyle: "hiddenInset" as const,
          acceptFirstMouse: true,
          transparent: true,
          backgroundColor: "#00000000",
          /** macOS 的系统材质；`under-window` 是「窗下」那一层，跟随窗口活跃态 */
          vibrancy: "under-window" as const,
          visualEffectState: "followWindow" as const,
        }
      : {}),
    webPreferences: {
      preload: resolve(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 工作台里的浏览器面板用 `<webview>` 承载（agent 驱动的也是它，见 docs/browser.md）
      webviewTag: true,
    },
  });

  /*
    嵌入的网页是**外部内容**：给它留出最小权限。guest 会继承宿主更严的安全档（sandbox / contextIsolation
    之类改不松），这里只确保没人从渲染层塞进 preload 或 node 集成——那等于把任意站点当本机代码跑。
  */
  // 浏览器标签登记给 CDP 转发用：只有这里登记的 webContents 才会接受服务端发来的命令
  window.webContents.on("did-attach-webview", (_event, guest) => {
    registerBrowserGuest(guest.id);
    guest.once("destroyed", () => unregisterBrowserGuest(guest.id));
  });

  window.webContents.on("will-attach-webview", (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  window.once("ready-to-show", () => window.show());
  // 系统红绿灯收起后，关窗 / 最小化 / 全屏由界面上的三颗点经 IPC 触发
  if (isFrameless(process.platform)) {
    window.setWindowButtonVisibility(false);
    watchWindowState(window);
  }

  // 打包后不受 `--dev` 影响：分发的应用只跑自己带的那份渲染层
  if (rendererDevUrl && !app.isPackaged) {
    installDevTools(window);
    void loadRenderer(window, rendererDevUrl);
  } else {
    void window.loadURL(`${RENDERER_ORIGIN}/index.html`);
  }
};

ipcMain.handle("desktop:connection", () => {
  // 渲染层的首个请求就是取连接，在这之前先按最新注册文件装好开发形态的注入
  refreshDevAuthInjection();
  const service = readServiceConnection();
  return {
    registered: service !== null,
    servicePath: serviceFilePath(),
    // 同一份注册既能拼 HTTP 也能拼 WS，渲染层生产形态要靠它直连服务
    websocketUrl: service ? service.baseUrl.replace(/^http/, "ws") : "",
  };
});

registerRendererScheme();
registerNotificationIpc();
registerWindowControlsIpc();
// 浏览器通道自己重试连接（服务可能晚于桌面端启动），这里只启动它
registerBrowserChannelIpc();

app.whenReady().then(() => {
  installRendererProtocol(rendererDist, readServiceConnection);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
