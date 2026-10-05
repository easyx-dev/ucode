/**
 * Electron 主进程：窗口生命周期、服务凭证注入与连接 IPC。
 *
 * 只连本机已运行的服务：从 `$APP_HOME/app/service.json` 读端点与 `serviceToken`，
 * 对发往该服务 API 的请求注入 Bearer；未运行 / 凭证失效时由渲染层给出可读提示。
 */
import { resolve } from "node:path";

import { app, BrowserWindow, ipcMain, session } from "electron";

import { readServiceConnection, serviceFilePath } from "./connection.ts";

const rendererDevUrl = process.env.DESKTOP_RENDERER_URL ?? "http://localhost:5174";

/** 只给服务 API 注入 Bearer：fetch / SSE / 附件 `<img>` 都经此带上凭证，凭证不进渲染层 */
const installAuthInjection = (baseUrl: string, token: string): void => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${baseUrl}/api/v1/*`] },
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
const refreshAuthInjection = (): void => {
  const connection = readServiceConnection();
  if (connection) installAuthInjection(connection.baseUrl, connection.token);
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

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: resolve(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once("ready-to-show", () => window.show());

  if (app.isPackaged) {
    void window.loadFile(resolve(import.meta.dirname, "../dist/index.html"));
  } else {
    void loadRenderer(window, rendererDevUrl);
  }
};

ipcMain.handle("desktop:connection", () => {
  // 渲染层的首个请求就是取连接，在这之前先按最新注册文件装好注入
  refreshAuthInjection();
  const connection = readServiceConnection();
  return { baseUrl: connection?.baseUrl ?? null, servicePath: serviceFilePath() };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
