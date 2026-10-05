/**
 * 打包主进程与预加载脚本。
 *
 * main 产出 ESM（package.json 为 `type: module`），preload 产出 CJS（Electron 沙箱预载的稳妥形态）。
 * `electron` 保持 external——它由 Electron 运行时提供，不打进产物。
 */
import { build } from "esbuild";

const root = `${import.meta.dirname}/..`;
const outDir = `${root}/dist-electron`;

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [`${root}/src/main/index.ts`],
  outfile: `${outDir}/main.js`,
  format: "esm",
});

await build({
  ...common,
  entryPoints: [`${root}/src/preload/index.ts`],
  outfile: `${outDir}/preload.cjs`,
  format: "cjs",
});
