/**
 * 桌面端驱动的端到端冒烟（步骤 4）：服务端会话 → 通道 → 桌面端主进程 → `webContents.debugger` → 真实页面。
 *
 * 为什么要有它：两边的单测各测一半（我们发什么 CDP、桌面端认不认这个 id），而**线上的帧形状**只有真跑一遍
 * 才验得到——帧字段写错时两边单测都会绿。这里把整条链路串起来：
 *
 * 1. 本进程起服务（隔离 `APP_HOME` + 端口）与一个本地页面（按钮点击后把标题改成「已点击」）；
 * 2. 起桌面端（构建产物），用 Playwright 连它自己的渲染层，把工作台里的浏览器标签打开到这个页面；
 * 3. 直接调服务端的动作面（`services.browsers.hooks`）：快照 → 点击 → 截图；
 * 4. 断言页面真的变了（标题经桌面端读回），并检查通道状态与截图字节数。
 *
 * 前置：`pnpm -F @ucode/desktop build`（渲染层与主进程产物要新；产物过期会直接报错）。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { serve } from "@hono/node-server";
import { chromium } from "playwright-core";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DESKTOP_DIR = resolve(REPO_ROOT, "apps/desktop");
const APP_HOME = resolve(REPO_ROOT, ".tmp/ucode-desktop-smoke");
const SERVICE_PORT = "19693";
const PAGE_PORT = "19797";
const CDP_PORT = "9335";

/*
  服务端模块必须在环境变量设好之后**动态**引入：`env` 在模块初始化时就固化 APP_HOME / APP_PORT，
  静态 import 会被提前求值，于是这个进程会去写默认的 `~/.ucode`——那是生产数据目录，
  注册文件会被本次冒烟的 pid 覆盖（踩过一次，已恢复）。
*/
process.env.APP_HOME = APP_HOME;
process.env.APP_PORT = SERVICE_PORT;

const { createApp } = await import("../src/app");
const { env } = await import("../src/env");
const { instanceId } = await import("../src/platform/instance");
const { ensureServiceRegistration, writeServiceRegistration } = await import(
  "../src/platform/service-registration"
);
const { createServices } = await import("../src/services");

if (resolve(env.homeDir) !== APP_HOME) {
  throw new Error(`APP_HOME 没生效（env.homeDir=${env.homeDir}）：拒绝继续，否则会写生产数据目录`);
}

/** 页面：点按钮后改标题，标题是本冒烟唯一的跨边界观察点（webview 的 DOM 我们读不到） */
const PAGE = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>驱动冒烟页</title></head>
  <body>
    <h1>驱动冒烟页</h1>
    <label for="name">名字</label>
    <input id="name" placeholder="请输入名字" />
    <button id="greet" onclick="document.title = '已点击'">问候</button>
    <p role="status" id="result">（未问候）</p>
  </body>
</html>`;

/** 最新的源码改动时间：产物比它旧就说明该先 build */
const newestSourceTime = (dir: string): number => {
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
];
const newestSource = Math.max(
  ...["src/main", "src/preload", "src/shared", "src/renderer"].map((dir) =>
    newestSourceTime(resolve(DESKTOP_DIR, dir)),
  ),
);
if (artifacts.some((path) => !existsSync(path) || statSync(path).mtimeMs < newestSource)) {
  console.error("桌面端产物缺失或已过期——先跑 pnpm -F @ucode/desktop build");
  process.exit(1);
}
// 每次从干净状态起：残留的 service.json 会让注册文件与本次进程对不上
rmSync(APP_HOME, { recursive: true, force: true });

const children: ReturnType<typeof spawn>[] = [];
const start = (
  name: string,
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    ...options,
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  children.push(child);
  return child;
};
const stopAll = () => {
  for (const child of children) {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};

const waitFor = async <T>(
  check: () => Promise<T | null> | T | null,
  timeoutMs: number,
  label: string,
) => {
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
  response.end(PAGE);
});

let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
try {
  await new Promise<void>((done) => pageServer.listen(Number(PAGE_PORT), "127.0.0.1", done));
  const pageUrl = `http://127.0.0.1:${PAGE_PORT}/page.html`;

  // 服务就地起：本进程既是服务端（动作面），也是这次冒烟的驱动方
  const { registration } = ensureServiceRegistration({
    path: env.servicePath,
    host: env.host,
    port: env.port,
  });
  const services = await createServices(registration);
  const { app, injectWebSocket } = createApp(services);
  const server = serve(
    { fetch: app.fetch, port: Number(SERVICE_PORT), hostname: "127.0.0.1" },
    (info) => {
      registration.port = info.port;
      registration.pid = process.pid;
      registration.instanceId = instanceId;
      writeServiceRegistration(env.servicePath, registration);
    },
  );
  injectWebSocket(server);
  await waitFor(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/v1/health`)).ok;
      } catch {
        return false;
      }
    },
    30_000,
    "服务健康检查",
  );
  console.log("✓ 服务已就绪（本进程）");

  start(
    "electron",
    resolve(DESKTOP_DIR, "node_modules/.bin/electron"),
    [
      ".",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${resolve(APP_HOME, "userdata")}`,
    ],
    {
      cwd: DESKTOP_DIR,
      env: { ...process.env, APP_HOME, APP_PORT: SERVICE_PORT, NODE_ENV: "development" },
    },
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
  const harness = await waitFor(
    async () => {
      const found =
        browser
          ?.contexts()
          .flatMap((context) => context.pages())
          .find((candidate) => !candidate.url().startsWith("devtools://")) ?? null;
      return found && (await found.title()) !== "" ? found : null;
    },
    60_000,
    "桌面端渲染层页面",
  );

  // 让面板打开到这个页面：标签一挂上，桌面端就会把标签报给服务端
  await harness
    .getByRole("button", { name: /工作台/ })
    .first()
    .click();
  await harness.waitForTimeout(800);
  await harness.getByRole("button", { name: "浏览器" }).click();
  await harness.waitForTimeout(400);
  await harness.getByRole("button", { name: "新标签" }).click();
  await harness.waitForTimeout(800);
  const address = harness.locator('input[aria-label="地址栏"]').first();
  await address.fill(pageUrl);
  await address.press("Enter");
  await waitFor(async () => (await address.inputValue()) === pageUrl, 20_000, "地址栏跟随导航");
  console.log("✓ 桌面端面板已打开本地页面，并已把标签报给服务端");

  const active = await waitFor(
    () => {
      const tab = services.browsers.desktop.activeTab();
      // 地址也要对上：guest 刚挂上时它报的还是 about:blank
      return tab && tab.webContentsId !== null && tab.url === pageUrl ? tab : null;
    },
    20_000,
    "服务端拿到可驱动的标签（地址已就位）",
  );
  assert.equal(active.url, pageUrl);
  console.log(`✓ 服务端认定要驱动的标签：${active.id}（webContents ${active.webContentsId}）`);

  // 走与工具完全相同的那条路：hooks → 会话
  const sessionId = "desktop-smoke";
  const session = services.browsers.hooks.acquire({
    sessionId,
    profile: "desktop",
    mode: "isolated",
    managedRequested: false,
  });
  assert.equal(session.mode, "desktop", "没显式要受管实例时应当驱动桌面端那一个");

  const snapshot = await session.snapshot({});
  assert.equal(snapshot.url, pageUrl);
  assert.match(snapshot.text, /button "问候"/, "快照要看到页面上的按钮");
  console.log(`✓ 快照：${snapshot.count} 个元素，首行 ${snapshot.text.split("\n")[0]}`);

  const greetRef = snapshot.text.match(/@(\S+) button "问候"/)?.[1] ?? "";
  const acted = await session.act({ action: "click", ref: greetRef });
  assert.equal(acted.navigated, false);
  // 跨边界观察：页面标题变了 —— 只有真的点到了那个页面才会变
  const title = await waitFor(
    async () =>
      harness
        .locator("webview")
        .first()
        .evaluate((node) => node.getTitle())
        .then((value) => (value === "已点击" ? value : null)),
    10_000,
    "页面标题被点击改掉",
  );
  assert.equal(title, "已点击");
  console.log("✓ act click：页面标题被改成「已点击」（跨进程确认真的点到了那个页面）");

  const shot = await session.screenshot({ fullPage: false });
  assert.ok(shot.data.length > 1_000, "截图应返回实际图像数据");
  assert.equal(shot.mimeType, "image/jpeg");
  console.log(`✓ screenshot：${(shot.data.length / 1024).toFixed(0)}KB（base64）`);

  // open 的语义：导航的是同一个标签（用户的页面被驱动，而不是新起一个浏览器）
  const opened = await session.open({ url: `${pageUrl}?again=1` });
  assert.equal(opened.url, `${pageUrl}?again=1`);
  const navigated = await waitFor(
    async () =>
      harness
        .locator("webview")
        .first()
        .evaluate((node) => node.getURL())
        .then((value) => (value.includes("again=1") ? value : null)),
    10_000,
    "面板里的标签跟着导航",
  );
  assert.equal(navigated, `${pageUrl}?again=1`);
  console.log("✓ browser_open：导航的就是面板里那个标签（面板地址跟着变）");

  // 元素选择：面板进点选模式 → 用 CDP 在页面里真点一下 → 摘要落进当前输入框
  await session.open({ url: pageUrl });
  const pickButton = harness.getByRole("button", { name: "选择页面元素" });
  await pickButton.click();
  await harness.waitForTimeout(300);
  assert.equal(await pickButton.getAttribute("aria-pressed"), "true", "按下后应进入点选模式");

  const pickSnapshot = await session.snapshot({});
  const pickRef = pickSnapshot.text.match(/@(\S+) button "问候"/)?.[1] ?? "";
  await session.act({ action: "click", ref: pickRef });

  // 落地在输入框里的是一枚芯片（节点），不是那一整段摘要——摘要只进消息正文
  const chip = await waitFor(
    async () => (await harness.locator("[data-page-element]").count()) > 0,
    10_000,
    "输入框里出现页面元素芯片",
  ).then(() => harness.locator("[data-page-element]").first());
  assert.equal(await chip.isVisible(), true, "芯片应当可见");
  const chipText = (await chip.innerText()).trim();
  assert.equal(chipText, "问候", "芯片上显示元素的可访问名");
  const composerText = await harness.locator("[contenteditable]").first().innerText();
  assert.ok(!composerText.includes("选择器："), "整段摘要不该铺在输入框里（它只进消息正文）");
  console.log(`✓ 元素选择：输入框里是一枚芯片「${chipText}」，摘要只进消息正文`);

  // 同文档导航（hash）也算导航：旧编号应当立刻失效
  await session.open({ url: `${pageUrl}#section` });
  const staleAfterHash = await session
    .act({ action: "click", ref: greetRef })
    .then(() => null)
    .catch((error: unknown) => error as { code?: string; staleRefs?: boolean });
  assert.equal(staleAfterHash?.code, "stale_ref");
  assert.equal(staleAfterHash?.staleRefs, true);
  console.log("✓ 同文档导航（hash）后旧编号失效");

  // 摘要里不该带着我们的高亮：那圈 outline 是采集时加的，不该进给模型看的片段
  const drafts = await harness.evaluate(() => {
    const storage = globalThis.localStorage;
    const key = Object.keys(storage).find((item) => item.endsWith("-composer-drafts"));
    return key ? (storage.getItem(key) ?? "") : "";
  });
  assert.match(drafts, /选择器：#greet/, "草稿正文里应当是完整摘要（芯片只影响编辑器的显示）");
  assert.ok(!drafts.includes("outline"), "高亮用的 outline 不该进摘要");
  console.log("✓ 摘要里没有高亮残留（草稿正文含完整摘要）");

  await session.close();
  console.log("\n桌面端驱动冒烟通过");
} catch (error) {
  console.error(`\n桌面端驱动冒烟失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  stopAll();
  pageServer.close();
  rmSync(APP_HOME, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}
