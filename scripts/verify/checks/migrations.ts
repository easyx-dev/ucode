/**
 * 迁移守卫。
 *
 * 迁移只追加、不得跳号：`migrations` 的版本键必须是从 1 开始的连续整数，
 * 且与 `SCHEMA_VERSION` 一致，每条都要有非空 DDL。规则见 docs/database.md。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_INDEX = "server/src/db/index.ts";

/** 匹配 `  1: \`...\`` 形式的迁移项，捕获版本号与 DDL 正文；缩进宽度不敏感 */
const ENTRY = /^\s+(\d+):\s*`([\s\S]*?)`/gm;

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const source = readFileSync(join(root, DB_INDEX), "utf8");

  const declared = Number(source.match(/SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
  if (!Number.isInteger(declared) || declared < 1) {
    problems.push(`${DB_INDEX}：读不到有效的 SCHEMA_VERSION`);
  }

  const entries = [...source.matchAll(ENTRY)].map((match) => ({
    version: Number(match[1]),
    ddl: match[2] ?? "",
  }));
  if (entries.length === 0) {
    problems.push(`${DB_INDEX}：没有解析到任何迁移项（期望在 migrations 里形如 "1: \`…\`"）`);
  }

  const versions = entries.map((entry) => entry.version).sort((a, b) => a - b);

  for (const entry of entries) {
    if (entry.ddl.trim().length === 0) {
      problems.push(`${DB_INDEX}：v${entry.version} 的 DDL 为空`);
    }
  }

  for (let expected = 1; expected <= versions.length; expected += 1) {
    if (versions[expected - 1] !== expected) {
      problems.push(`${DB_INDEX}：迁移版本必须从 1 起连续，缺少 v${expected}`);
      break;
    }
  }

  const latest = versions.at(-1);
  if (latest !== undefined && latest !== declared) {
    problems.push(`${DB_INDEX}：SCHEMA_VERSION(${declared}) 与最大迁移版本(v${latest}) 不一致`);
  }

  return problems;
};
