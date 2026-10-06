/**
 * 打包 server 生产产物：`server/src/cli.ts` → `dist/ucode.js`（单文件）。
 *
 * `pnpm start` 即 `node dist/ucode.js`。只 bundle 本仓库代码（server + 工作区包
 * @ucode/brand、@ucode/contracts）；第三方依赖一律保持 external，由根 package.json 的
 * dependencies 提供——pi SDK 带原生 / wasm 依赖与运行期动态加载，整棵打进单文件不可靠。
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
  },
  sourcemap: true,
  logLevel: "info",
});
