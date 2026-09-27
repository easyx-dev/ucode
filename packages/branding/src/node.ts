import { homedir } from "node:os";
import { join } from "node:path";
import { envVar, getBrand } from "./index.ts";

/**
 * 宿主运行时目录：服务注册表、unix socket 与服务日志。
 *
 * 单独成一个入口（`@ucode/branding/node`）而不是放进包主入口：主入口被浏览器壳
 * （`apps/web`）共用，**它必须是浏览器安全的**——`node:os` / `node:path` 进去就打包失败。
 *
 * 可用环境变量覆盖：测试靠它把运行时状态隔离到临时目录，避免并行用例互相踩。
 */
export function runtimeDir(): string {
  const fromEnv = process.env[envVar("RUNTIME_DIR")];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return join(homedir(), getBrand().runtimeDirName);
}
