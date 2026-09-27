import { getBrand } from "@ucode/branding";
import type { TuiOptions } from "../options.ts";
import { log } from "../runtime.ts";
import { ensureService, servicePaths } from "../service-registry.ts";

/**
 * `tui` —— 启动内置 TUI 壳。
 *
 * **壳是客户端**：默认确保本机服务在跑（发现→连上；没有就拉起），再经 unix socket 连它。
 * `--core <endpoint>` 连别处的服务（unix socket / tcp / http）。
 *
 * 为什么不再"自己 spawn 一个核心层就算完"：那样每个壳各成一个后端，两个壳打开同一个会话
 * 会互相把对方挤成只读；而壳被 kill 时留下的孤儿核心层会一直占着 owner 租约（旧实现里这是
 * "发消息没反应"的常见来源）。BS 架构下只有一个后端，这些问题不存在。
 *
 * 界面在 `@ucode/tui` 里，它只依赖 sdk（不复用 ui，spec §7.2）。
 */
export async function runTui(options: TuiOptions): Promise<number> {
  const { runTui: startTui } = await import("@ucode/tui");
  const productName = getBrand().productName;

  if (options.coreEndpoint !== undefined) {
    return startTui({ productName, endpoint: options.coreEndpoint });
  }

  const live = await ensureService({
    dataDir: options.dataDir,
    cwd: options.cwd,
    host: "127.0.0.1",
  });
  const { unix, http } = live.registration.endpoints;
  if (unix !== undefined) {
    return startTui({ productName, endpoint: { kind: "rpc", socketPath: unix } });
  }
  if (http !== undefined) {
    log(`服务未提供 unix socket，改用 HTTP 端点：${http}`);
    return startTui({ productName, endpoint: { kind: "http", baseUrl: http } });
  }
  throw new Error(`服务没有可用端点。请查看日志：${servicePaths(options.dataDir).log}`);
}
