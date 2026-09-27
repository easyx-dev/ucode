import { getBrand } from "@ucode/branding";
import { ensureService, servicePaths } from "@ucode/service";
import type { TuiOptions } from "../options.ts";
import { log } from "../runtime.ts";
import { serviceCommand } from "../service-command.ts";

/**
 * `tui` —— 启动内置 TUI 壳。
 *
 * **壳是客户端**：默认确保本机服务在跑（发现 → 连上；没有就拉起），再经 unix socket 连它。
 * `--core <endpoint>` 连别处的服务（unix socket / tcp / http）。
 *
 * 界面在 `@ucode/tui` 里，它只依赖 sdk（不复用 ui）。
 */
export async function runTui(options: TuiOptions): Promise<number> {
  const { runTui: startTui } = await import("@ucode/tui");
  const productName = getBrand().productName;

  if (options.coreEndpoint !== undefined) {
    return startTui({ productName, endpoint: options.coreEndpoint });
  }

  const paths = servicePaths(options.dataDir);
  const live = await ensureService({
    paths,
    command: serviceCommand({ root: paths.root, cwd: options.cwd, host: "127.0.0.1" }),
  });
  const { unix, http } = live.registration.endpoints;
  if (unix !== undefined) {
    return startTui({ productName, endpoint: { kind: "rpc", socketPath: unix } });
  }
  if (http !== undefined) {
    log(`服务未提供 unix socket，改用 HTTP 端点：${http}`);
    return startTui({ productName, endpoint: { kind: "http", baseUrl: http } });
  }
  throw new Error(`服务没有可用端点。请查看日志：${paths.log}`);
}
