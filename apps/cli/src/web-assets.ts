import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./runtime.ts";

/**
 * Web 壳的构建产物定位。
 *
 * 单独成模块是因为两个调用方都要它：服务的 HTTP 绑定（把静态资源发出去）与 `web` 子命令
 * （确认产物存在再打开浏览器）。放在任一命令里都会让另一个反向 import，形成环。
 */

/**
 * Web 壳的构建产物目录。
 *
 * 两种来源：
 * - **显式目录**（`--web-assets`）：打包后的桌面壳把 Web 产物放进自己的 bundle 目录，
 *   那里没有 workspace 包树，只能由主进程告诉服务层产物在哪；
 * - **从 `@ucode/web` 的包清单定位**（默认）：不按仓库相对路径猜，开发形态与安装形态都成立。
 */
export async function resolveWebAssets(explicitDir?: string): Promise<string> {
  if (explicitDir !== undefined && explicitDir !== "") {
    const index = join(explicitDir, "index.html");
    if (!existsSync(index)) {
      throw new Error(`--web-assets 指向的目录里没有 index.html：${explicitDir}`);
    }
    return explicitDir;
  }
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
