/**
 * CI 的准备步骤：从模板生成 `.env` / `.env.prod`。
 *
 * 这两个文件因机器而异、不入库，而服务启动与提示词装配都要读它们（缺失即报错退出），
 * 所以 CI 上得先从模板造出来。已经存在的文件一律不动——本地手动跑这个脚本不该覆盖自己的配置。
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

for (const name of [".env", ".env.prod"]) {
  const target = resolve(root, name);
  if (existsSync(target)) continue;

  const template = `${target}.example`;
  if (!existsSync(template)) {
    console.warn(`跳过 ${name}：模板 ${name}.example 不存在`);
    continue;
  }
  copyFileSync(template, target);
  console.log(`已从 ${name}.example 生成 ${name}`);
}
