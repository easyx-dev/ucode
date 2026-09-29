/**
 * 契约守卫。
 *
 * 两条硬性约束（见 docs/api.md「契约组织与类型绑定」）：
 * 1. 字段名一律 camelCase，不允许下划线；
 * 2. 每个 `*Request` 类型都必须有成对的 `*Input`，保证客户端载荷与服务端入参两档齐全。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listFiles } from "../files.ts";

const FIELD = /^\s+([A-Za-z_$][\w$]*)\??:\s/gm;
const INPUT_TYPE = /export type (\w+Input)\b/g;
const REQUEST_TYPE = /export type (\w+Request)\b/g;

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const files = listFiles(root, "packages/contracts/src", (path) => path.endsWith(".ts"));

  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");

    for (const match of source.matchAll(FIELD)) {
      const name = match[1];
      if (name?.includes("_")) {
        problems.push(`${file}：字段名必须是 camelCase，发现 "${name}"`);
      }
    }

    const inputs = new Set([...source.matchAll(INPUT_TYPE)].map((match) => match[1]));
    for (const match of source.matchAll(REQUEST_TYPE)) {
      const request = match[1];
      const base = request?.replace(/Request$/, "");
      if (base && !inputs.has(`${base}Input`)) {
        problems.push(`${file}：${request} 缺少配对的 ${base}Input`);
      }
    }
  }

  return problems;
};
