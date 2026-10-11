/**
 * 随包资源的定位基准：web 产物、`package.json` 都相对它找。
 *
 * 从模块位置向上找 `pnpm-workspace.yaml` 标记，不依赖固定的目录层级——源码运行（tsx）与打包后的
 * 单文件产物下 `import.meta.dirname` 不同，靠标记才能落到同一个根。
 * 独立成模块是因为 `cli.ts` 要在读环境配置之前就拿它（`--help` / `--version` 不该被 env 的缺失退出拦住）。
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** 从 start 向上查找含 pnpm-workspace.yaml 的仓库根；找不到返回 undefined */
const findRepoRoot = (start: string): string | undefined => {
  let current = start;
  for (;;) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/** 仓库根；标记缺失时回落到上一级（打包后就是产物所在目录） */
const repoRoot = findRepoRoot(import.meta.dirname);

/** 随包资源的定位基准 */
export const resourceRoot = repoRoot ?? resolve(import.meta.dirname, "..");
