// 桌面壳主进程（Electron）。
//
// 与 web / tui 同一条路子：**壳是客户端**。主进程做三件事：
// 1. **确保共享服务在跑**（发现 → 连上，没有就用打包好的 CLI 拉起一个 detached 的）；
// 2. 把服务的 HTTP 端点交给窗口，界面（同一份 Web 产物）**由服务同源发出**——
//    没有 CORS、没有跨站问题，桌面与浏览器看到的是同一个界面；
// 3. 托盘 / 通知 / OS 凭据 / 保持唤醒这些**本机能力**留在主进程，经 preload 暴露。
//
// 退出桌面**不杀服务**：它是与 web / tui 共享的后端，停止用 `服务名 service stop`。
//
// **为什么是 .mjs 且纯 JS**：Electron 直接加载主进程与 preload，不经过打包器；
// 类型剥离不适用于它，因此这里不能有任何 TS 语法。渲染进程（React）才走 Vite 构建。

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  powerSaveBlocker,
  safeStorage,
  Tray,
} from "electron";
import { CredentialStore, credentialsFileFor } from "./src/native/credentials.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const smokeMode = process.argv.includes("--smoke");

/** 品牌是数据（ADR-023）：主进程同样从 brand.json 读，不写死。 */
function readBrand() {
  const brandUrl = import.meta.resolve("@ucode/branding/brand.json");
  return JSON.parse(readFileSync(fileURLToPath(brandUrl), "utf8"));
}

const brand = readBrand();
const productName = brand.productName;
const envDataDir = process.env[`${productName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_DATA_DIR`];
const dataDir = envDataDir ?? join(homedir(), brand.dataDirName);
const cwd =
  process.env[`${productName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CWD`] ?? process.cwd();

function resolveCliEntry() {
  // 打包布局：main.mjs 在 app.asar 里，core-bundle 被 asarUnpack 到 app.asar.unpacked
  const isPackaged = here.includes("app.asar");
  if (isPackaged) {
    const bundled = `${here.replace("app.asar", "app.asar.unpacked")}/core-bundle/cli.mjs`;
    if (existsSync(bundled)) return bundled;
    throw new Error(`找不到打包的服务层入口（${bundled}）`);
  }
  // 仓内布局：main.mjs → ../cli/src/main.ts（Node 24 原生类型剥离直跑）
  const relative = join(here, "..", "cli", "src", "main.ts");
  if (existsSync(relative)) return relative;
  throw new Error(`找不到 CLI 入口（${relative}）：桌面壳需要它来拉起共享服务。`);
}

let windows = [];

/** 服务注册表在运行时目录里（`<数据根>/runtime/service.json`）。 */
function registrationFile() {
  return join(dataDir, "runtime", "service.json");
}

/** 读注册表并确认那个进程还活着；拿不到就当作"没有服务"。 */
function readLiveRegistration() {
  try {
    const registration = JSON.parse(readFileSync(registrationFile(), "utf8"));
    if (typeof registration?.pid !== "number") return undefined;
    process.kill(registration.pid, 0);
    return registration;
  } catch {
    return undefined;
  }
}

/** 拉起常驻服务：detached + 日志进运行时目录（与 CLI 的 `service start` 同一条路子）。 */
function spawnService() {
  // ELECTRON_RUN_AS_NODE=1：Electron 自带的 Node 跑 CLI 入口（应用里没有独立的 node 二进制）
  const child = spawn(
    process.execPath,
    [
      "--conditions=dev-src",
      resolveCliEntry(),
      "service",
      "start",
      "--data-dir",
      dataDir,
      "--cwd",
      cwd,
      // 打包形态：Web 产物随 core-bundle 分发，得把位置告诉服务层（开发形态自动能解析到）
      ...(packagedWebAssets() === undefined ? [] : ["--web-assets", packagedWebAssets()]),
    ],
    { cwd, detached: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  child.unref();
}

/** 打包后的 Web 产物目录（在 asar 之外，服务层读得到）。 */
function packagedWebAssets() {
  if (!here.includes("app.asar")) return undefined;
  const dir = `${here.replace("app.asar", "app.asar.unpacked")}/core-bundle/web-assets`;
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}

/** 确保共享服务在跑，返回它的 HTTP 端点（界面由服务同源发出）。 */
async function ensureServiceEndpoint(timeoutMs = 25_000) {
  const existing = readLiveRegistration();
  if (existing !== undefined && typeof existing.endpoints?.http === "string") {
    return existing.endpoints.http;
  }
  spawnService();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const registration = readLiveRegistration();
    if (registration !== undefined && typeof registration.endpoints?.http === "string") {
      return registration.endpoints.http;
    }
    if (Date.now() > deadline) {
      throw new Error(`等待服务就绪超时：${registrationFile()}（日志见同目录 service.log）`);
    }
    await new Promise((done) => setTimeout(done, 150));
  }
}

/** 凭据存储（F-5.4）：懒建，加密不可用时 set 会抛错（宁可不存，也不落明文）。 */
let credentials;
function credentialStore() {
  credentials ??= new CredentialStore({
    file: credentialsFileFor(dataDir),
    crypto: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (buffer) => safeStorage.decryptString(buffer),
    },
  });
  return credentials;
}

/** 保持唤醒（F-4.4）：服务层暴露 keepAwake，主进程据此阻止系统休眠。 */
let keepAwakeBlocker = null;
function setKeepAwake(enabled) {
  if (enabled === true && keepAwakeBlocker === null) {
    keepAwakeBlocker = powerSaveBlocker.start("prevent-app-suspension");
  } else if (enabled !== true && keepAwakeBlocker !== null) {
    if (powerSaveBlocker.isStarted(keepAwakeBlocker)) powerSaveBlocker.stop(keepAwakeBlocker);
    keepAwakeBlocker = null;
  }
  return keepAwakeBlocker !== null;
}

function registerIpc(serviceEndpoint) {
  // 端点交给界面：渲染进程用 sdk 的 HTTP 传输直连（与服务同源，没有跨站问题）。
  ipcMain.handle("desktop:environment", () => ({
    productName,
    dataDir,
    serviceEndpoint,
  }));

  // 保持唤醒：渲染进程根据 SDK 的 keepAwake 切换。
  ipcMain.handle("desktop:keep-awake", (_event, enabled) => setKeepAwake(enabled === true));

  // 系统通知：渲染进程可主动弹一条（托盘常驻时窗口可能在后台）。
  ipcMain.handle("desktop:notify", (_event, payload) => {
    if (!Notification.isSupported()) return false;
    new Notification({
      title: typeof payload?.title === "string" ? payload.title : productName,
      body: typeof payload?.body === "string" ? payload.body : "",
    }).show();
    return true;
  });

  // 凭据：只暴露"名字 + 值"这一层，密文与落盘位置留在主进程。
  ipcMain.handle("desktop:credential-list", () => credentialStore().list());
  ipcMain.handle("desktop:credential-set", (_event, name, value) => {
    credentialStore().set(name, value);
    return true;
  });
  ipcMain.handle("desktop:credential-get", (_event, name) => credentialStore().get(name));
  ipcMain.handle("desktop:credential-delete", (_event, name) => credentialStore().delete(name));

  // 内置浏览器（F-2.9）：开一个独立窗口加载 URL。
  ipcMain.handle("desktop:browser-open", (_event, url) => {
    if (typeof url !== "string" || !/^https?:\/\//iu.test(url)) {
      throw new Error("只允许 http(s) 地址。");
    }
    const window = new BrowserWindow({ width: 1024, height: 760, title: url });
    void window.loadURL(url);
    return true;
  });
}

function createWindow(serviceEndpoint) {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: productName,
    backgroundColor: "#1b1b1f",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void window.loadURL(serviceEndpoint);
  windows.push(window);
  window.on("closed", () => {
    windows = windows.filter((candidate) => candidate !== window);
  });
  return window;
}

/**
 * 托盘（F-5.4 的本机能力之一）：常驻入口 + 菜单（显示/隐藏、退出）。
 * 没有图标资源时跳过——托盘是锦上添花，不该让主功能起不来。
 */
function tryCreateTray() {
  try {
    const iconPath = join(here, "assets", "tray.png");
    if (!existsSync(iconPath)) return;
    const tray = new Tray(iconPath);
    tray.setToolTip(productName);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: `显示 ${productName}`,
          click: () => {
            const window = windows[0] ?? createWindow();
            window.show();
            window.focus();
          },
        },
        {
          label: "隐藏窗口",
          click: () => {
            for (const window of windows) window.hide();
          },
        },
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => {
      const window = windows[0];
      if (window === undefined) {
        createWindow();
        return;
      }
      if (window.isVisible()) window.hide();
      else {
        window.show();
        window.focus();
      }
    });
  } catch {
    // 没有托盘不影响主功能
  }
}

app.whenReady().then(async () => {
  let serviceEndpoint;
  try {
    serviceEndpoint = await ensureServiceEndpoint();
  } catch (error) {
    process.stderr.write(
      `[desktop] 服务未就绪：${error instanceof Error ? error.message : String(error)}\n`,
    );
    app.quit();
    return;
  }
  process.stderr.write(`[desktop] 服务端点：${serviceEndpoint}\n`);

  registerIpc(serviceEndpoint);
  const window = createWindow(serviceEndpoint);
  tryCreateTray();

  if (smokeMode) {
    // 冒烟：等渲染进程起来、协议消息开始流动，然后截屏退出（供自动化验收）
    setTimeout(async () => {
      try {
        const image = await window.webContents.capturePage();
        const { writeFileSync } = await import("node:fs");
        const out = process.env.UCODE_SMOKE_OUT ?? "/tmp/desktop-smoke.png";
        writeFileSync(out, image.toPNG());
        const summary = await window.webContents
          .executeJavaScript("document.body.innerText.slice(0, 400)")
          .catch(() => "(读取渲染内容失败)");
        process.stderr.write(
          `[desktop] 冒烟截图已写入 ${out}\n[desktop] 渲染内容：${summary.replace(/\n/g, " | ")}\n`,
        );
      } catch (error) {
        process.stderr.write(
          `[desktop] 冒烟截图失败：${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 3;
      } finally {
        app.quit();
      }
    }, 8_000);
  }
});

app.on("before-quit", () => {
  // 不杀服务：它是与 web / tui 共享的后端（一个数据根一个服务，生命周期由 `service` 子命令管）。
  // 需要连服务一起停时用：<产品名> service stop
});

app.on("window-all-closed", () => {
  app.quit();
});
