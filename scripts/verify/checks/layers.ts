/**
 * 分层守卫。
 *
 * `server/src` 的分层与依赖方向（见 AGENTS.md「仓库落位」）：
 *   routes → services → core → harness → pi
 *   platform 是基建，不许反向依赖上层。
 *
 * 这里只约束「可检查、且现在事实成立」的四条；跨层但合规的例外（如 core 取用 harness 的能力）
 * 不在此列。规则收窄为目录前缀 + `import type` 判定，避免误报。
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { listFiles } from "../files.ts";

/** 一条依赖约束 */
type Rule = {
  /** 约束的发起方：满足即为受约束的文件 */
  from: (file: string) => boolean;
  /** 违规的落点：满足即报错 */
  to: (target: string) => boolean;
  /** 为 true 时该依赖只允许 `import type` */
  typeOnly: boolean;
  /** 报错文案里说明这条规则在守什么 */
  reason: string;
};

const isUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);
const isTest = (path: string): boolean => path.includes("/__tests__/");

/** 依赖方向的上游各层；基建与纯函数都不得反向依赖它们 */
const UPPER_LAYERS = [
  "server/src/routes",
  "server/src/services",
  "server/src/core",
  "server/src/harness",
  "server/src/db",
  "server/src/config",
];

const isUpperLayer = (target: string): boolean => UPPER_LAYERS.some((dir) => isUnder(target, dir));

const RULES: Rule[] = [
  {
    from: (file) => isUnder(file, "server/src/harness") && !isTest(file),
    to: (target) => isUnder(target, "server/src/core"),
    typeOnly: true,
    reason: "harness 依赖 core 只能取类型；需要编排能力时由 core 以回调的形式注入",
  },
  {
    from: (file) => isUnder(file, "server/src/harness/pi"),
    to: (target) =>
      isUnder(target, "server/src/harness/setup") || isUnder(target, "server/src/harness/features"),
    typeOnly: false,
    reason: "pi 适配层只能依赖 contracts 与 harness 的共用原语，不得反向依赖装配或运行期能力",
  },
  {
    from: (file) => isUnder(file, "server/src/harness/utils"),
    to: (target) =>
      isUnder(target, "server/src/harness/pi") ||
      isUnder(target, "server/src/harness/setup") ||
      isUnder(target, "server/src/harness/features"),
    typeOnly: false,
    reason: "harness 的公共方法（utils）不得依赖 pi 适配、装配或运行期能力",
  },
  {
    from: (file) => isUnder(file, "server/src/core") && !isTest(file),
    to: (target) => isUnder(target, "server/src/services"),
    typeOnly: false,
    reason: "core 是内核，不得依赖应用层的 services",
  },
  {
    from: (file) => isUnder(file, "server/src/platform") && !isTest(file),
    to: isUpperLayer,
    typeOnly: false,
    reason: "platform 是基建，不得反向依赖任何上层",
  },
  {
    from: (file) => isUnder(file, "server/src/utils") && !isTest(file),
    to: (target) => isUpperLayer(target) || isUnder(target, "server/src/platform"),
    typeOnly: false,
    reason: "utils 只放无业务语义的纯函数，不得引用任何 server 层",
  },
];

type Dependency = { specifier: string; line: number; typeOnly: boolean };

/**
 * 静态依赖的取法：`import … from "…"` 与重新导出 `export … from "…"` 都算。
 *
 * `import` 那条用 `(?!["'])` 排掉无 `from` 的副作用导入（`import "./x"`）——否则懒匹配会跨到
 * 下一条 `from` 上，拿到错误的说明符与 `import type` 判定。`export * as ns from` 这种少见写法暂不覆盖。
 */
const DEPENDENCY_PATTERNS = [
  /^import\s+(?!["'])([\s\S]*?)\bfrom\s+["']([^"']+)["']/gm,
  /^export\s+(type\s+)?(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/gm,
];

const dependenciesOf = (source: string): Dependency[] => {
  const records: Dependency[] = [];
  for (const pattern of DEPENDENCY_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const clause = match[1] ?? "";
      records.push({
        specifier: match[2] ?? "",
        // 行号取说明符所在语句的首行，便于定位
        line: source.slice(0, match.index).split("\n").length,
        typeOnly: /^\s*type\b/.test(clause),
      });
    }
  }
  return records;
};

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const files = listFiles(root, "server/src", (path) => path.endsWith(".ts"));

  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    for (const dependency of dependenciesOf(source)) {
      if (!dependency.specifier.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), dependency.specifier));

      for (const rule of RULES) {
        if (!rule.from(file) || !rule.to(target)) continue;
        if (rule.typeOnly && dependency.typeOnly) continue;
        problems.push(`${file}:${dependency.line}：${rule.reason}（${dependency.specifier}）`);
      }
    }
  }

  return problems;
};
