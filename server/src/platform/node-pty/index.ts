/**
 * node-pty 预编译二进制的执行位修正。
 *
 * 发布的 prebuild 里 `spawn-helper` 是 644，而 `pty.spawn` 会把它交给 `posix_spawn` 去执行，
 * 于是报 `posix_spawnp failed`。`scripts/postinstall.mjs` 在安装时修一次，但安装脚本不可靠：
 * `pnpm add -g` 默认不跑依赖的构建脚本、`--ignore-scripts` 也到不了，所以服务启动时再幂等修一次。
 * 没有预编译的平台（Linux 本地编译）产物本来就可执行，这里是无害的空转。
 */
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** 预编译与本地编译两条产物路径；Windows 走 conpty，没有这个 helper */
const spawnHelperPaths = (): string[] => {
  if (process.platform === "win32") return [];
  let packageRoot: string;
  try {
    packageRoot = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  } catch {
    return [];
  }
  return [
    join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    join(packageRoot, "build", "Release", "spawn-helper"),
  ];
};

/** 本次进程已处理过的路径：启动期调用一次即可，重复调用不必再 chmod */
const ensured = new Set<string>();

/** 补上执行位（已可执行时无副作用）；返回本次真正改过的路径，供调用方记日志 */
export const ensureSpawnHelperExecutable = (): string[] => {
  const fixed: string[] = [];
  for (const path of spawnHelperPaths()) {
    if (ensured.has(path) || !existsSync(path)) continue;
    ensured.add(path);
    try {
      chmodSync(path, 0o755);
      fixed.push(path);
    } catch {
      // 改不动也不阻断启动：没有终端需求的会话照样能用
    }
  }
  return fixed;
};
