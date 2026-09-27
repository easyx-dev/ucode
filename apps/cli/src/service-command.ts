import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ServiceCommand } from "@ucode/service";

/**
 * 以"前台服务"重新启动自己的参数。
 *
 * 宿主库（`@ucode/service` 的 host）不假设 CLI 的目录布局，重入参数由调用方给出——
 * 于是同一套 ensure/spawn 逻辑在 CLI、安装形态与桌面壳的 bundle 里都能用。
 */

/** 入口：dev 直跑源码（Node 原生类型剥离），安装形态跑 dist。 */
function cliEntry(): string {
  const source = fileURLToPath(new URL("./main.ts", import.meta.url));
  if (existsSync(source)) return source;
  return fileURLToPath(new URL("./main.js", import.meta.url));
}

export type ServiceLaunchOptions = {
  /** 数据根。 */
  root: string;
  cwd: string;
  host: string;
  port?: number;
  allowNonLoopback?: boolean;
  noHttp?: boolean;
};

export function serviceCommand(options: ServiceLaunchOptions): ServiceCommand {
  return {
    executable: process.execPath,
    args: [
      "--conditions=dev-src",
      // SQLite 走 Node 内建的 node:sqlite（实验特性）：常驻服务的日志里不必每次都带这条警告。
      "--disable-warning=ExperimentalWarning",
      cliEntry(),
      "service",
      "start",
      "--foreground",
      "--data-dir",
      options.root,
      "--cwd",
      options.cwd,
      "--host",
      options.host,
      ...(options.port === undefined ? [] : ["--port", String(options.port)]),
      ...(options.allowNonLoopback === true ? ["--allow-non-loopback"] : []),
      ...(options.noHttp === true ? ["--no-http"] : []),
    ],
  };
}
