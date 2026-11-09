/**
 * 构建随包插件的产物（`ui/*.tsx → dist/ui/*.mjs`、`ui/*.css` 原样拷、`server/index.ts → dist/server.mjs`）。
 *
 * **为什么在根仓里构建、而不是用插件仓自己的 `scripts/build.mjs`**：
 * 官方插件允许复用宿主的 UI 原语（`@ucode/ui/base/*`），而插件仓里没有宿主的 `node_modules`——
 * 依赖（radix / lucide / hono …）只有从根仓解析得到。所以这里以根仓为 `absWorkingDir`，
 * 把 `@ucode/ui` 别名指到源码、把 `react` / `react/jsx-runtime` / `@ucode/plugin-api` 设成 external
 * （它们由宿主运行时提供，插件自带 React 会让 hooks 报 Invalid hook call）。
 *
 * 第三方插件用插件仓或自己的构建即可：它们只能依赖 `@ucode/plugin-api` 暴露的能力面。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const pluginsRoot = resolve(root, "plugins");

/** 品牌 slug：全局运行时键名由它派生（与 `packages/ui` 那边的注入点同一口径） */
const brandSlug = /slug:\s*"([^"]+)"/.exec(
  readFileSync(resolve(root, "packages/brand/src/brand.ts"), "utf8"),
)?.[1];
if (!brandSlug) throw new Error("读不到品牌 slug（packages/brand/src/brand.ts）");
const HOST_GLOBAL = `__${brandSlug.toUpperCase()}_PLUGIN_HOST__`;

/** 由宿主运行时提供的模块：一律不打进插件产物 */
const HOST_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@ucode/plugin-api",
];

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const manifestOf = (dir) => {
  const file = join(dir, ".ucode-plugin", "plugin.json");
  return existsSync(file) ? readJson(file) : null;
};

/** 需要构建的插件：清单声明了 `ui` 或 `server` */
const pluginsToBuild = () => {
  const result = [];
  for (const group of ["plugins", "external_plugins"]) {
    const base = join(pluginsRoot, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      const manifest = manifestOf(dir);
      if (!manifest) continue;
      if (!manifest.ui && !manifest.server) continue;
      result.push({ name, dir, manifest });
    }
  }
  return result;
};

/** 目录里某后缀的文件（不含子目录） */
const filesWithExtension = (dir, extension) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(extension)) : [];

/** 清单里声明的界面模块 → 源文件（`./dist/ui/view.mjs` → `ui/view.tsx`） */
const declaredUiEntries = (manifest, dir) => {
  const ui = manifest.ui ?? {};
  const modules = [
    ...(ui.views ?? []),
    ...(ui.docRenderers ?? []),
    ...(ui.mentions ?? []),
    ...(ui.settingsSections ?? []),
  ]
    .map((item) => (typeof item.module === "string" ? item.module : null))
    .filter((module) => typeof module === "string");
  const names = new Set();
  for (const module of modules) {
    const match = /^\.\/dist\/ui\/(.+)\.mjs$/.exec(module);
    if (match) names.add(`${match[1]}.tsx`);
  }
  if (names.size === 0) return filesWithExtension(join(dir, "ui"), ".tsx");
  // 清单指了某个模块却找不到源码：直接失败，别打出一个「0 个界面模块」的产物
  const missing = [...names].filter((name) => !existsSync(join(dir, "ui", name)));
  if (missing.length > 0) {
    throw new Error(`${dir}: 清单声明的界面模块缺少源码：${missing.join(" / ")}`);
  }
  return [...names];
};

/** 界面模块：清单声明的入口各自打成一个 .mjs（内部模块一起打进去） */
const buildUi = async ({ dir, manifest }) => {
  const uiDir = join(dir, "ui");
  const entries = declaredUiEntries(manifest, dir);
  for (const entry of entries) {
    await build({
      absWorkingDir: root,
      entryPoints: [join(uiDir, entry)],
      outfile: join(dir, "dist", "ui", entry.replace(/\.tsx$/, ".mjs")),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      external: HOST_EXTERNALS,
      // 第三方依赖里还有 CJS 的 `require("react")`：ESM 产物里 esbuild 会把它变成
      // 「Dynamic require of "react" is not supported」。宿主在挂运行时的时候会装一张同名的
      // CJS 表（`globalThis.__UCODE_PLUGIN_CJS__`），这里给 `require` 一个指向它的垫片。
      banner: {
        js:
          `const require = (id) => { const table = globalThis.${HOST_GLOBAL}?.cjs;` +
          ` const value = table?.[id]; if (value === undefined) throw new Error("插件运行时缺少 CommonJS 依赖：" + id);` +
          ` return value; };`,
      },
      alias: { "@ucode/ui": join(root, "packages/ui/src") },
      resolveExtensions: [".tsx", ".ts", ".js", ".mjs", ".json"],
      // 插件目录在自己的 pnpm 工程里，第三方包（lucide / cn / radix…）只在宿主的工作区包下：
      // 让解析器把 `packages/ui/node_modules` 也当成查找根
      nodePaths: [join(root, "packages/ui/node_modules"), join(root, "node_modules")],
      logLevel: "warning",
    });
  }
  for (const style of filesWithExtension(uiDir, ".css")) {
    copyFileSync(join(uiDir, style), join(dir, "dist", "ui", style));
  }
  return entries.length;
};

/** 服务端模块：`server/index.ts`（或 `.mjs`）打成一个自包含文件；宿主能解析的包保持 external */
const buildServer = async ({ dir, manifest }) => {
  const serverDir = join(dir, "server");
  const entry = ["index.ts", "index.mjs"].map((file) => join(serverDir, file)).find(existsSync);
  if (!manifest.server) return false;
  if (!entry)
    throw new Error(`${dir}: 清单声明了 server，但 server/index.ts 或 server/index.mjs 不存在`);
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: join(dir, "dist", "server.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    // pi 的能力由宿主以参数注入（`ctx.pi`），插件不该、也解析不到它，故不打包
    external: ["@earendil-works/*"],
    logLevel: "warning",
  });
  return true;
};

if (!existsSync(pluginsRoot)) {
  console.warn(
    "⚠ 跳过随包插件构建：plugins 子模块未初始化（发版前请先 git submodule update --init）",
  );
  process.exit(0);
}

const targets = pluginsToBuild();
if (targets.length === 0) {
  console.log("没有需要构建的插件（清单里没有 ui / server 声明的插件都是纯资源插件）");
} else {
  for (const target of targets) {
    rmSync(join(target.dir, "dist"), { recursive: true, force: true });
    mkdirSync(join(target.dir, "dist", "ui"), { recursive: true });
    const uiCount = await buildUi(target);
    const server = await buildServer(target);
    console.log(`✓ ${target.name}: ${uiCount} 个界面模块${server ? " + 服务端模块" : ""}`);
  }
}
