/**
 * 运行形态与资源定位。
 *
 * 资源根（仓库根）从模块位置向上找 `pnpm-workspace.yaml` 标记，不依赖固定的目录层级；
 * 环境文件按 `NODE_ENV` 选择（生产 `.env.prod` / 其余 `.env`），统一从 cwd 向上查找。
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

/** 仓库根；标记缺失时回落到上一级（资源定位基准） */
const repoRoot = findRepoRoot(import.meta.dirname);

/** 随包资源的定位基准（web 产物、package.json 等） */
export const resourceRoot = repoRoot ?? resolve(import.meta.dirname, "..");

/** 当前应加载的环境文件名：生产 `.env.prod`，其余 `.env`（按 NODE_ENV 选择） */
export const envFileName = (): string =>
  process.env.NODE_ENV === "production" ? ".env.prod" : ".env";

/**
 * 展开开头的 `~`（只处理 `~` 与 `~/`，`~user` 交给后续解析报不存在）。
 * 与 `utils/path` 共用同一份实现：`~` 展开全仓只应有一套口径。
 */
export { expandHome } from "../../utils/path";

/** 加载环境文件前 process.env 里已有的键（CLI 参数 / shell 变量），用于区分「显式设置」与「.env 默认」 */
let presetKeys: ReadonlySet<string> = new Set();

/** 该变量是否在加载环境文件前就已显式设置（区别 `.env` 注入的默认值） */
export const wasPreset = (name: string): boolean => presetKeys.has(name);

/** 从 start 向上查找指定环境文件，返回其绝对路径；找不到返回 undefined */
const findEnvFile = (start: string, fileName: string): string | undefined => {
  let current = start;
  for (;;) {
    const candidate = resolve(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/**
 * 加载从 cwd 向上的环境文件，返回相对路径的解析基准（文件所在目录，无则 cwd）。
 *
 * 基准取环境文件所在目录而非仓库根：`APP_HOME` 常写成相对路径（如开发模板里的 `.tmp/<品牌>`），
 * 只有相对它解析，在仓库内运行才能落到预期目录。
 */
export const loadEnvFile = (): string => {
  // 先快照：CLI 参数（--host/--port）与 shell 变量在加载环境文件前就已就位，
  // 后续取值要靠它把「显式设置」与「.env 声明的默认值」区分开
  presetKeys = new Set(Object.keys(process.env));

  const envFile = findEnvFile(process.cwd(), envFileName());
  if (envFile) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // 环境文件存在但不可读时按未设置处理，缺失项由 env 校验兜底
    }
    return dirname(envFile);
  }
  return process.cwd();
};
