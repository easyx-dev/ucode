/**
 * 打包 server 生产产物：`server/src/cli.ts` → `dist/ucode.js`（单文件）。
 *
 * `pnpm start` 即 `node dist/ucode.js`。npm 全局安装后 `bin` 直接跑同一个文件，所以产物首行的 shebang 是
 * 安装形态的前提（`banner`）。sourcemap 只给仓库内调试用，不进发布包（`.map` 带 `sourcesContent`，
 * 等于把整份 TS 源码装进去；运行期也要 `--enable-source-maps` 才会用它，见 package.json 的 `files`）。
 * 只 bundle 本仓库代码（server + 工作区包
 * @ucode/brand、@ucode/contracts、@ucode/hub-protocol）；第三方依赖一律保持 external，由根
 * package.json 的 dependencies 提供——pi SDK 带原生 / wasm 依赖与运行期动态加载，整棵打进单文件不可靠。
 * 新增工作区依赖时必须在这里补 alias：`packages: "external"` 会把它的裸导入一并外置，而工作区包
 * 只链在各自的 node_modules 下（pnpm 隔离安装），产物从仓库根解析不到它，启动即 ERR_MODULE_NOT_FOUND。
 * 依赖外置意味着启动时从仓库根 node_modules 解析，故根 dependencies 必须覆盖 server 的运行时依赖
 * （`scripts/verify` 的 manifest 校验兜底）。
 */
import { resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

await build({
  entryPoints: [resolve(root, "server/src/cli.ts")],
  outfile: resolve(root, "dist/ucode.js"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  alias: {
    "@ucode/brand/values": resolve(root, "packages/brand/src/brand.ts"),
    "@ucode/contracts": resolve(root, "packages/contracts/src/index.ts"),
    "@ucode/hub-protocol": resolve(root, "packages/hub-protocol/src/index.ts"),
  },
  sourcemap: true,
  // `bin` 在 unix 上直接执行这个文件，没有 shebang 会以 shell 语法解析报错
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
