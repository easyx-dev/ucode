/**
 * 依赖镜像守卫。
 *
 * `pnpm start` 跑的是 esbuild 产物 `dist/ucode.js`，第三方依赖被设为 external，运行时会从
 * **入口所在仓库根**的 `node_modules` 解析——而依赖的事实源在 `server/package.json`（pnpm 隔离安装，
 * 那些包默认只在 `server/node_modules`）。所以根 `package.json` 必须声明同一批第三方依赖，
 * 漏一个就表现为 `pnpm start` 启动即 `Cannot find module`。工作区包由 esbuild 打进产物，不需要声明。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readDependencies = (root: string, dir: string): Record<string, string> => {
  const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return manifest.dependencies ?? {};
};

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const rootDeps = readDependencies(root, ".");
  const serverDeps = readDependencies(root, "server");

  for (const [name, version] of Object.entries(serverDeps)) {
    if (name.startsWith("@ucode/")) continue;
    const declared = rootDeps[name];
    if (declared === version) continue;
    problems.push(
      declared
        ? `package.json：dependencies.${name} 为 ${declared}，与 server 的 ${version} 不一致`
        : `package.json：缺少 dependencies.${name}（server 运行时依赖 ${version}，pnpm start 需要它）`,
    );
  }

  return problems;
};
