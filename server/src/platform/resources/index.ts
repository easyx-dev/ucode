/**
 * 随包资源的定位基准：web 产物、`package.json` 都相对它找。
 *
 * 从模块位置向上找最近的「资源根标记」——`package.json` 里 `resourceRoot: true` 的目录。
 * 不依赖固定的目录层级：源码运行（tsx）下标记在本仓根 `package.json`，npm 安装后标记在包自己的清单里
 * （`node_modules/<包名>`），同一条规则就能覆盖两种形态；本地把本包装进别人的 workspace 时，
 * 包自己的标记比项目根更近，也不会认错成项目根。
 * 独立成模块是因为 `cli.ts` 要在读环境配置之前就拿它（`--help` / `--version` 不该被 env 的缺失退出拦住）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** 资源根标记字段：包清单里为 true 即认定该目录是随包资源的基准 */
const RESOURCE_ROOT_FIELD = "resourceRoot";

/** 源码树标记：本仓的 pnpm workspace 清单，npm 安装后的包里没有 */
const SOURCE_TREE_MARKER = "pnpm-workspace.yaml";

/** 该目录是不是资源根：清单缺失或不可解析都当否 */
const isResourceRoot = (dir: string): boolean => {
  try {
    const manifest = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    return manifest[RESOURCE_ROOT_FIELD] === true;
  } catch {
    return false;
  }
};

/** 从 start 向上找最近的资源根；找不到返回 undefined */
export const findResourceRoot = (start: string): string | undefined => {
  let current = resolve(start);
  for (;;) {
    if (isResourceRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/** 随包资源的定位基准；标记缺失时回落到上一级（打包后就是产物所在目录） */
export const resourceRoot =
  findResourceRoot(import.meta.dirname) ?? resolve(import.meta.dirname, "..");

/**
 * 随包插件仓的根（资源根下的 `plugins/`）：内含官方插件目录与它们的构建产物。
 * 具体哪些是「随包插件」写在 `constants/plugins` 的 `PACKAGED_PLUGINS`，不靠扫目录判定。
 */
export const packagedPluginsRoot = resolve(resourceRoot, "plugins");

/**
 * 是否跑在源码树里（资源根带 pnpm workspace 清单）。
 * 安装包内没有这个文件，`env` 据此决定要不要用随包默认配置兜底——源码树里漏写环境文件时
 * 静默落到默认主目录（本机往往就是生产目录）比直接报错危险得多。
 */
export const isSourceTree = existsSync(resolve(resourceRoot, SOURCE_TREE_MARKER));
