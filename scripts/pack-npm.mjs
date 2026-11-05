/**
 * 打出待发布的 tarball 到 `.tmp/`（不存在就建），并打印产物路径与体积。
 *
 * 用 `pnpm pack` 而不是 `npm pack`：只有 pnpm 会把 `catalog:` 改写成真实版本，用 npm 打出来的包装不上。
 * 这一份就是 `pnpm publish` 会发出去的内容，发布前拿它核对文件清单（见 README「发布到 npm」）。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, ".tmp");
mkdirSync(destination, { recursive: true });

const result = spawnSync("pnpm", ["pack", "--pack-destination", destination], {
  cwd: root,
  stdio: "inherit",
  // Windows 上 pnpm 是 .cmd，必须经 shell 才找得到
  shell: process.platform === "win32",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
// npm / pnpm 的包文件名：scope 去掉 @，斜杠换成连字符
const fileName = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
console.log(
  `\n待发布 tarball：.tmp/${fileName}（${(statSync(resolve(destination, fileName)).size / 1024 / 1024).toFixed(1)} MB）`,
);
