/**
 * 服务连接解析：定位 `$APP_HOME/app/service.json` 并读出端点与凭证。
 *
 * 与 server 的 `env.ts` 同源约定——读仓库 `.env`，`APP_HOME` 缺省落在 `~/<appHomeDirname>`，
 * 相对路径按仓库根解析。文件由服务独占写、客户端只读，读得到即本机身份证明
 * （见 plans/service-and-auth.md）。凭证只留在主进程，不进渲染层。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

import { appHomeDirname } from "@ucode/brand/values";

/** 从起点向上找含 `pnpm-workspace.yaml` 的目录；源码运行与打包产物的层级不同，靠标记自身定位 */
const findRepoRoot = (start: string): string | undefined => {
  let current = start;
  for (;;) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

const repoRoot = findRepoRoot(import.meta.dirname);

if (repoRoot) {
  try {
    process.loadEnvFile(resolve(repoRoot, ".env"));
  } catch {
    // 没有 .env 时全部使用默认值
  }
}

/** 与 server 同口径：`APP_HOME` 相对路径按仓库根解析，缺省落在 `~/<appHomeDirname>` */
export const resolveHomeDir = (value = process.env.APP_HOME): string => {
  const raw = value?.trim();
  if (!raw) return resolve(homedir(), appHomeDirname);
  return isAbsolute(raw) ? raw : resolve(repoRoot ?? process.cwd(), raw);
};

/** 服务注册文件：`<APP_HOME>/app/service.json`（目录名与文件名与 server 常量对齐） */
export const serviceFilePath = (homeDir = resolveHomeDir()): string =>
  resolve(homeDir, "app", "service.json");

export type ServiceConnection = {
  /** 服务 API 根地址，如 http://127.0.0.1:2048 */
  baseUrl: string;
  /** 本机原生客户端凭证（Bearer） */
  token: string;
};

/** 注册文件内容 → 连接信息；host 为通配地址（0.0.0.0 / ::）时改用回环连接 */
export const toServiceConnection = (raw: unknown): ServiceConnection | null => {
  if (!raw || typeof raw !== "object") return null;
  const { host, port, serviceToken } = raw as Record<string, unknown>;
  if (typeof host !== "string" || host === "") return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) return null;
  if (typeof serviceToken !== "string" || serviceToken === "") return null;
  const connectHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return { baseUrl: `http://${connectHost}:${port}`, token: serviceToken };
};

/** 读取并解析注册文件；缺失或损坏返回 null */
export const readServiceConnection = (path = serviceFilePath()): ServiceConnection | null => {
  try {
    return toServiceConnection(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
};
