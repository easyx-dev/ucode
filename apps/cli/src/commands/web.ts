import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBinding as createHttpBinding } from "@ucode/binding-http";
import { createCore } from "@ucode/core";
import type { WebOptions } from "../options.ts";
import { log, waitForShutdown } from "../runtime.ts";

/**
 * `web` —— 启动内置 Web 壳。
 *
 * 一个端口同时提供：核心层（进程内）+ HTTP/SSE 绑定 + Web 壳静态资源。
 * 同源的好处是没有 CORS、没有 cookie 的跨站问题；Web 壳因此直接用 `location.origin` 连接。
 *
 * 只监听环回（spec §5.3）；`--allow-non-loopback` 会把信任级别降为 untrusted（只读 + 对话）。
 */
export async function runWeb(options: WebOptions): Promise<number> {
  const staticDir = await resolveWebAssets();
  const core = await createCore({ dataDir: options.dataDir, cwd: options.cwd });
  const binding = createHttpBinding(core, {
    host: options.host,
    port: options.port,
    staticDir,
    ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
  });

  await binding.start();
  log(`Web 壳已启动：${binding.endpoint}`);
  log(`  数据层：${core.dataDir}`);
  log(`  静态资源：${staticDir}`);
  log(
    `  信任级别：${binding.trustLevel}${binding.trustLevel === "local" ? "（仅本机可访问）" : "（未认证，只读 + 对话）"}`,
  );

  await waitForShutdown();
  log("正在关闭……");
  await binding.stop();
  await core.close();
  return 0;
}

/**
 * Web 壳的构建产物目录。
 *
 * 从 `@ucode/web` 的包清单定位，而不是按仓库相对路径猜——这样打包后仍然成立。
 */
export async function resolveWebAssets(): Promise<string> {
  let manifestPath: string;
  try {
    manifestPath = import.meta.resolve("@ucode/web/package.json");
  } catch {
    throw new Error("找不到 @ucode/web 包（Web 壳未安装）。");
  }
  const webDir = dirname(fileURLToPath(manifestPath));
  const distDir = join(webDir, "dist");
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Web 壳尚未构建（缺少 ${indexPath}）。请先运行：pnpm -F @ucode/web build`);
  }
  const stale = newestSourceMtime(webDir);
  if (stale !== null && mtimeMs(indexPath) < stale.ms) {
    // 这一条是给开发者看的：`web` 服务的是**构建产物**，改完源码不重建就会看到旧界面，
    // 而且看不出哪里不对（实测：UI 改动完全不生效，误以为"没写对"）。
    log(
      `  ⚠ Web 壳的构建产物比源码旧（${stale.file} 更新）。界面上看不到最近的改动——` +
        "请先运行：pnpm -F @ucode/web build",
    );
  }
  return distDir;
}

/**
 * 找出"最近被改过的源码"（含 `@ucode/ui`——壳的界面主体在那个包里）。
 *
 * `@ucode/ui` **要按 web 包自己的视角解析**（`createRequire(webDir/package.json)`）：
 * 它不是 cli 的依赖，从 cli 这边 `import.meta.resolve` 一定失败。
 *
 * 只在开发形态下做这件事：以包安装时源码不随包分发，找不到就跳过——**不猜、不报错**。
 */
function newestSourceMtime(webDir: string): { file: string; ms: number } | null {
  const roots = [join(webDir, "src")];
  try {
    const requireFromWeb = createRequire(join(webDir, "package.json"));
    roots.push(join(dirname(requireFromWeb.resolve("@ucode/ui/package.json")), "src"));
  } catch {
    // 没有 ui 源码（安装形态）：只比 web 自己的
  }
  let newest: { file: string; ms: number } | null = null;
  for (const root of roots) {
    for (const file of walk(root)) {
      const ms = mtimeMs(file);
      if (newest === null || ms > newest.ms) newest = { file, ms };
    }
  }
  return newest;
}

function* walk(dir: string): Generator<string> {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function mtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
