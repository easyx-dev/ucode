// 把核心层 + CLI 打成单文件（供打包后的桌面壳 spawn）。
//
// 打包后的桌面应用没有 workspace 源码树，也没有 Node 的类型剥离——所以 CLI 入口
// 必须预编译成纯 JS。esbuild 打包 apps/cli/src/main.ts（核心层 + 全部绑定 + 基座
// 一并进来），platform=node，format=esm；基座里 jiti 的动态加载在运行期解析，
// 保持 external 以免打包器误折。

import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, "..");
const outDir = join(desktopDir, "core-bundle");

await mkdir(outDir, { recursive: true });
await esbuild.build({
  entryPoints: [join(desktopDir, "..", "cli", "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // 从源码打包：dist 是为「以包安装」准备的产物，打包桌面壳时不该依赖它。
  conditions: ["dev-src"],
  outfile: join(outDir, "cli.mjs"),
  // ws 及其可选加速依赖（来自 @hono/node-ws）含运行期 require：
  // ESM 输出里 esbuild 的 require shim 会抛错——保持 external，由打包目录的 node_modules 提供
  external: [
    "electron",
    "@earendil-works/pi-coding-agent",
    "jiti",
    "node-pty",
    "ws",
    "bufferutil",
    "utf-8-validate",
  ],
  // ink 的 devtools 仅在开发期且是可选依赖（未安装）：重定向到空模块
  alias: { "react-devtools-core": join(here, "empty-shim.mjs") },
  sourcemap: false,
  logLevel: "info",
});

// 基座与其插件运行时体积大且含原生/动态部分：作为依赖随包分发，不打进 bundle
await writeFile(
  join(outDir, "package.json"),
  JSON.stringify(
    {
      name: "desktop-core",
      private: true,
      type: "module",
      dependencies: {
        // 打包目录自带的运行期依赖（external 的包在这里提供）
        "@earendil-works/pi-coding-agent": "0.87.1",
        "node-pty": "1.1.0",
        ws: "^8.21.3",
      },
    },
    null,
    2,
  ),
);
console.log("core bundle 就绪：", join(outDir, "cli.mjs"));
