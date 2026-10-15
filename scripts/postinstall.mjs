/**
 * 安装后修正：`node-pty` 发布的预编译二进制里，`spawn-helper` 丢了执行位（644），
 * 于是 `pty.spawn` 会以 `posix_spawnp failed` 失败——它把 helper 交给 posix_spawn 去执行。
 *
 * 补上执行位即可；没有预编译的平台（Linux）由 node-gyp 编译，产物本来就可执行，这里也无害。
 */
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const spawnHelpers = () => {
  // Windows 走 conpty，没有这个 helper
  if (process.platform === "win32") return [];
  let packageRoot;
  try {
    packageRoot = dirname(require.resolve("node-pty/package.json"));
  } catch {
    // 未安装（如只装了部分 workspace）时什么都不做
    return [];
  }
  return [
    join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    join(packageRoot, "build", "Release", "spawn-helper"),
  ];
};

const fixed = [];
for (const file of spawnHelpers()) {
  if (!existsSync(file)) continue;
  chmodSync(file, 0o755);
  fixed.push(file);
}

if (fixed.length > 0) {
  console.log(`node-pty：spawn-helper 已设为可执行（${fixed.join("、")}）`);
}
