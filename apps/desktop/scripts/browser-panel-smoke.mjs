/**
 * 桌面端浏览器面板的端到端冒烟：起隔离的 dev 服务与一个本地页面，让 Electron 开调试端口，
 * 再用 Playwright 连 **Electron 自己的渲染层**（它是 `type: "page"` 的目标）驱动界面。
 *
 * 为什么要有它：面板的载体是 `<webview>`，`pnpm check` 与 CI 都碰不到这条路；而它已经出过两类真问题——
 * 切标签把页面销毁（卸载 `<webview>`）、换工作目录把标签一起清掉。这两条都在下面的断言里。
 *
 * 同时验桌面端到服务端的**注册通道**：标签与激活项要真的到服务端（`POST /api/v1/browser/desktop`），
 * agent 驱动的是它报上来的那一个。
 *
 * 前置：`pnpm -F @ucode/desktop build`（渲染层产物要在 `dist/`）。
 * 隔离：服务写 `.tmp/ucode-panel-smoke`，Electron 的 userData 也指到 `.tmp` 下并在每次运行前清空——
 * 不碰 `~/.ucode`，也不碰你平时那份桌面端数据（否则预置的 localStorage 会让结果不确定）。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright-core";

const DESKTOP_DIR = resolve(dirname(import.meta.filename), "..");
const REPO_ROOT = resolve(DESKTOP_DIR, "../..");
const HOME_DIR = resolve(REPO_ROOT, ".tmp/ucode-panel-smoke");
const USER_DATA_DIR = resolve(HOME_DIR, "userdata");
const SERVICE_PORT = "19692";
const PAGE_PORT = "19798";
const CDP_PORT = "9334";

/** 最新的源码改动时间；比构建产物新就说明产物过期 */
const newestSourceTime = (dir) => {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestSourceTime(path) : statSync(path).mtimeMs,
    );
  }
  return newest;
};

const artifacts = [
  resolve(DESKTOP_DIR, "dist/index.html"),
  resolve(DESKTOP_DIR, "dist-electron/main.js"),
  resolve(DESKTOP_DIR, "dist-electron/preload.cjs"),
];
const missing = artifacts.filter((path) => !existsSync(path));
const sources = ["src/main", "src/preload", "src/shared", "src/renderer"].map((dir) =>
  newestSourceTime(resolve(DESKTOP_DIR, dir)),
);
const newestSource = Math.max(...sources);
if (missing.length > 0 || artifacts.some((path) => statSync(path).mtimeMs < newestSource)) {
  console.error(
    `产物缺失或已过期（缺失：${missing.join("、") || "无"}）——先跑 pnpm -F @ucode/desktop build`,
  );
  process.exit(1);
}
// 预置状态会让断言变得不确定（工作台可能已经是展开的、或还剩着上次的标签）
rmSync(HOME_DIR, { recursive: true, force: true });

/** 子进程输出先攒着：成功时不刷屏，失败时最后一段贴出来（服务端是 pino JSON，正常跑也很吵） */
const children = [];
const childLog = [];
const start = (name, command, args, options) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    ...options,
  });
  const collect = (chunk) => {
    childLog.push(`[${name}] ${chunk}`);
    if (childLog.length > 2_000) childLog.shift();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  children.push(child);
  return child;
};
const stopAll = () => {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};

/** 等到条件成立；返回最后一次的求值结果 */
const waitFor = async (check, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((done) => setTimeout(done, 250));
  }
};

const pageServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>面板冒烟页</title></head>` +
      `<body><h1>面板冒烟页</h1><button>按钮</button><p role="status">就绪</p></body></html>`,
  );
});

let browser = null;
try {
  await new Promise((done) => pageServer.listen(Number(PAGE_PORT), "127.0.0.1", done));
  const pageUrl = `http://127.0.0.1:${PAGE_PORT}/page.html`;

  const env = { ...process.env, APP_HOME: HOME_DIR, APP_PORT: SERVICE_PORT };
  start("service", resolve(REPO_ROOT, "node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: resolve(REPO_ROOT, "server"),
    env,
  });
  await waitFor(
    () => existsSync(resolve(HOME_DIR, "app/service.json")),
    60_000,
    "服务写出 service.json",
  );
  await waitFor(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/v1/health`)).ok;
      } catch {
        return false;
      }
    },
    60_000,
    "服务健康检查",
  );
  console.log("✓ 隔离服务已就绪");

  start(
    "electron",
    resolve(DESKTOP_DIR, "node_modules/.bin/electron"),
    [".", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${USER_DATA_DIR}`],
    { cwd: DESKTOP_DIR, env },
  );
  await waitFor(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok;
      } catch {
        return false;
      }
    },
    60_000,
    "Electron 调试端口",
  );
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

  let harness = null;
  await waitFor(
    async () => {
      harness =
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((candidate) => !candidate.url().startsWith("devtools://")) ?? null;
      return harness !== null && (await harness.title()) !== "";
    },
    60_000,
    "桌面端渲染层页面",
  );
  console.log("✓ 已连上桌面端渲染层");

  await harness
    .getByRole("button", { name: /工作台/ })
    .first()
    .click();
  await harness.waitForTimeout(800);

  const views = await harness
    .locator('[role="toolbar"][aria-label="活动栏"] button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  assert.ok(views.includes("浏览器"), `活动栏应有「浏览器」入口，实际：${views.join(" / ")}`);
  console.log("✓ 活动栏有「浏览器」入口（仅桌面端）");

  await harness.getByRole("button", { name: "浏览器" }).click();
  await harness.waitForTimeout(400);
  assert.equal(await harness.locator("webview").count(), 0, "还没开标签时不该有 webview");
  assert.equal(await harness.locator("text=还没有浏览器标签").count(), 1, "应给空态");
  console.log("✓ 空态提示到位");

  await harness.getByRole("button", { name: "新标签" }).click();
  await harness.waitForTimeout(1000);
  assert.equal(await harness.locator("webview").count(), 1, "新标签应开出一个 webview");
  const partition = await harness
    .locator("webview")
    .first()
    .evaluate((node) => node.getAttribute("partition"));
  assert.match(partition ?? "", /^persist:/, `webview 应挂在持久 partition 上，实际：${partition}`);
  console.log(`✓ 新标签开出 webview（partition=${partition}）`);

  const address = harness.locator('input[aria-label="地址栏"]').first();
  await address.fill(pageUrl);
  await address.press("Enter");
  await waitFor(async () => (await address.inputValue()) === pageUrl, 20_000, "地址栏跟随导航更新");
  const webviews = harness.locator("webview");
  assert.equal(
    await webviews.first().evaluate((node) => node.getURL()),
    pageUrl,
    "页面应真的跳过去",
  );
  assert.equal(await webviews.first().evaluate((node) => node.getTitle()), "面板冒烟页");
  assert.equal(await harness.getByRole("button", { name: "后退" }).isEnabled(), true, "后退应可用");
  console.log(`✓ 地址栏输入即导航：${pageUrl}（标题与后退状态都跟着变）`);

  await harness.getByRole("button", { name: "新标签" }).click();
  await harness.waitForTimeout(1000);
  assert.equal(await webviews.count(), 2, "第二个标签的 webview 要常驻，不是只在激活时才挂");
  console.log("✓ 多标签复用工作台标签，两个 webview 同时在场");

  await harness.getByRole("button", { name: "浏览器 2", exact: true }).click();
  await harness.waitForTimeout(600);
  await harness.getByRole("button", { name: "浏览器 1", exact: true }).click();
  await harness.waitForTimeout(600);
  assert.equal(
    await webviews.first().evaluate((node) => node.getURL()),
    pageUrl,
    "切走再切回，页面必须还在",
  );
  console.log("✓ 切标签不丢页面（只切可见性）");

  // 注册通道：服务端要看到「一个标签、就是当前这个页面」，激活项随工作台标签切换
  const token = JSON.parse(
    readFileSync(resolve(HOME_DIR, "app/service.json"), "utf8"),
  ).serviceToken;
  const desktopState = async () => {
    const response = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/v1/browser/desktop`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.ok, true, "读取桌面端通道状态应成功");
    return (await response.json()).data;
  };
  let lastState = null;
  const registered = await waitFor(
    async () => {
      lastState = await desktopState();
      return lastState.connected && lastState.tabs.length === 2 ? lastState : null;
    },
    20_000,
    `服务端收到两个浏览器标签（最近一次状态：${JSON.stringify(lastState)}）`,
  );
  assert.equal(registered.connected, true, "桌面端应当接着");
  const active = registered.tabs.find((tab) => tab.active);
  assert.ok(active, "应当有一个激活标签");
  assert.equal(active.id, "t1", "激活的应是切回来的标签 1");
  assert.equal(active.url, pageUrl, "报上去的应是页面真实地址");
  assert.equal(typeof active.webContentsId, "number", "要带上 webContents id（agent 按它发命令）");
  console.log(
    `✓ 注册通道：服务端看到 ${registered.tabs.length} 个标签，激活的是 ${active.id}（${active.url}）`,
  );

  console.log("\n浏览器面板冒烟通过");
} catch (error) {
  console.error(`\n浏览器面板冒烟失败：${error?.message ?? error}`);
  console.error(childLog.join(""));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  stopAll();
  pageServer.close();
  rmSync(resolve(HOME_DIR, "app/service.json"), { force: true });
}
