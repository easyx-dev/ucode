/**
 * 打出待发布的 tarball 到 `.tmp/`（不存在就建），核对条目并打印路径与体积。
 *
 * 用 `pnpm pack` 而不是 `npm pack`：只有 pnpm 会把 `catalog:` 改写成真实版本，用 npm 打出来的包装不上。
 * 这一份就是 `pnpm publish` 会发出去的内容，所以这里顺手挡住「`files` 白名单漏项」这类错误——
 * 它不会让发布失败，只会让装出来的包少一层界面或起不来（见 README「发布到 npm」）。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** 必须随包发布的条目：产物、web 界面、默认配置、清单 */
const REQUIRED_ENTRIES = [
  "package/package.json",
  "package/dist/ucode.js",
  "package/apps/web/dist/index.html",
  "package/defaults/default.conf",
];

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, ".tmp");

/** Windows 上 pnpm / tar 是 .cmd 或系统自带封装，必须经 shell 才找得到 */
const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });

mkdirSync(destination, { recursive: true });

const packed = run("pnpm", ["pack", "--pack-destination", destination], { stdio: "inherit" });
if (packed.status !== 0) process.exit(packed.status ?? 1);

const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
// npm / pnpm 的包文件名：scope 去掉 @，斜杠换成连字符
const fileName = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
const tarball = resolve(destination, fileName);

const listed = run("tar", ["-tzf", tarball]);
if (listed.status !== 0) {
  console.error(`读不出 tarball 条目：${listed.stderr?.trim() || `tar 退出码 ${listed.status}`}`);
  process.exit(1);
}
const entries = new Set(listed.stdout.split("\n").map((line) => line.trim()));
const missing = REQUIRED_ENTRIES.filter((entry) => !entries.has(entry));
if (missing.length > 0) {
  console.error(`发布包缺少必需条目：${missing.join(" / ")}（检查 package.json 的 files）`);
  process.exit(1);
}

console.log(
  `\n待发布 tarball：.tmp/${fileName}（${(statSync(tarball).size / 1024 / 1024).toFixed(1)} MB，` +
    `${entries.size} 个条目）`,
);
