/**
 * 会话条目字典守卫（见 docs/session-entries.md）。
 *
 * 契约里的 `*_CUSTOM_TYPE` 常量值必须登记在字典里，字典里出现的 `ucode.*` 也必须有对应常量——
 * 双向校验，避免「加了条目没人登记」与「文档写了常量已删」两种漂移。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listFiles } from "../files.ts";

const DOC = "docs/session-entries.md";

/** 契约里的条目类型常量：`export const XXX_CUSTOM_TYPE = "ucode.xxx"` */
const CUSTOM_TYPE_CONST = /export const (\w+_CUSTOM_TYPE)\s*=\s*"([^"]+)"/g;

/** 字典里用反引号登记的类型名；只认 `ucode.` 前缀的实际值，不认占位说明 */
const DOCUMENTED_TYPE = /`(ucode\.[a-z0-9-]+)`/g;

export const run = (root: string): string[] => {
  const problems: string[] = [];
  let doc: string;
  try {
    doc = readFileSync(join(root, DOC), "utf8");
  } catch {
    return [`${DOC} 不存在：会话条目类型必须有单一登记处`];
  }

  const documented = new Set([...doc.matchAll(DOCUMENTED_TYPE)].map((match) => match[1]));
  const declared = new Map<string, string>();

  for (const file of listFiles(root, "packages/contracts/src", (path) => path.endsWith(".ts"))) {
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(CUSTOM_TYPE_CONST)) {
      const [, name, value] = match;
      if (!name || !value) continue;
      declared.set(value, `${file} 的 ${name}`);
      if (!documented.has(value)) {
        problems.push(`${file}：${name}（${value}）未登记到 ${DOC}`);
      }
    }
  }

  for (const value of documented) {
    if (!declared.has(value)) {
      problems.push(`${DOC}：${value} 没有对应的契约常量（或常量已删）`);
    }
  }

  return problems;
};
