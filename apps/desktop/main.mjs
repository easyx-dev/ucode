// 桌面壳主进程（Electron）。
//
// 职责（spec §7.1：主进程 spawn 核心层 + 托盘/通知/OS 凭据等廉价本机能力）：
// 1. **spawn 核心层子进程**（stdio 绑定）——桌面壳与核心层之间没有 HTTP，走协议 C 的 JSONL 线；
// 2. 把渲染进程的协议消息经 IPC 桥到子进程的 stdin，把子进程的 stdout 按字节切行后推给渲染进程；
// 3. 开窗口、装托盘（图标缺省时跳过）、退出时优雅关停核心层（释放 owner 租约）。
//
// **为什么是 .mjs 且纯 JS**：Electron 直接加载主进程与 preload，不经过打包器；
// 类型剥离不适用于它，因此这里不能有任何 TS 语法。渲染进程（React）才走 Vite 构建。

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, Tray } from "electron";

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
    const bundled = here.replace("app.asar", "app.asar.unpacked") + "/core-bundle/cli.mjs";
    if (existsSync(bundled)) return bundled;
    throw new Error(`找不到打包的核心层入口（${bundled}）`);
  }
  // 仓内布局：main.mjs → ../cli/src/main.ts（Node 24 原生类型剥离直跑）
  const relative = join(here, "..", "cli", "src", "main.ts");
  if (existsSync(relative)) return relative;
  throw new Error(`找不到 CLI 入口（${relative}）：桌面壳需要一个能跑 core start 的入口。`);
}

function resolveRendererIndex() {
  const dist = join(here, "dist-renderer", "index.html");
  if (!existsSync(dist)) {
    throw new Error(`渲染进程尚未构建（缺少 ${dist}）。请先运行：pnpm -F @ucode/desktop build`);
  }
  return dist;
}

let core;
let windows = [];

function spawnCore() {
  // ELECTRON_RUN_AS_NODE=1：用 Electron 自带的 Node 跑 CLI 入口（它没有独立的 node 二进制）
  const child = spawn(
    process.execPath,
    [resolveCliEntry(), "core", "start", "--binding", "stdio", "--data-dir", dataDir, "--cwd", cwd],
    {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr?.on("data", (chunk) => {
    // 核心层的日志走 stderr；主进程转发到自己的 stderr 便于诊断
    process.stderr.write(`[core] ${chunk.toString("utf8")}`);
  });
  child.on("exit", (code) => {
    process.stderr.write(`[desktop] 核心层退出（code=${code ?? "null"}）\n`);
    core = undefined;
    for (const window of windows) {
      window.webContents.send("desktop:core-exit", `核心层进程退出（code=${code ?? "null"}）`);
    }
  });
  return child;
}

/** 按字节切分（协议 B：只认 0x0a，禁用行读取器——JSON 字符串里可以有 U+2028/U+2029）。 */
function attachLineFraming(child, onLine) {
  let buffer = Buffer.alloc(0);
  child.stdout?.on("data", (chunk) => {
    buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
    for (;;) {
      const index = buffer.indexOf(0x0a);
      if (index === -1) break;
      const line = buffer.subarray(0, index).toString("utf8").trim();
      buffer = buffer.subarray(index + 1);
      if (line === "") continue;
      onLine(line);
    }
  });
}

function registerIpc() {
  ipcMain.on("desktop:send", (_event, message) => {
    if (core === undefined) core = spawnCore();
    core.stdin?.write(`${JSON.stringify(message)}\n`);
  });
  ipcMain.handle("desktop:environment", () => ({ productName, dataDir }));
}

function createWindow() {
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
  void window.loadURL(pathToFileURL(resolveRendererIndex()).href);
  windows.push(window);
  window.on("closed", () => {
    windows = windows.filter((candidate) => candidate !== window);
  });
  return window;
}

/** 托盘：没有图标资源时跳过（托盘是廉价本机能力，不是本步的验收点）。 */
function tryCreateTray() {
  try {
    const iconPath = join(here, "assets", "tray.png");
    if (!existsSync(iconPath)) return;
    const tray = new Tray(iconPath);
    tray.setToolTip(productName);
  } catch {
    // 没有托盘不影响主功能
  }
}

app.whenReady().then(() => {
  registerIpc();
  core = spawnCore();
  attachLineFraming(core, (line) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // 非 JSON 行忽略
    }
    for (const window of windows) {
      window.webContents.send("desktop:message", parsed);
    }
  });

  const window = createWindow();
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
  // 优雅退出：核心层收到 SIGTERM 会释放 owner 租约（spec §3.5）
  core?.kill("SIGTERM");
  core = undefined;
});

app.on("window-all-closed", () => {
  app.quit();
});
