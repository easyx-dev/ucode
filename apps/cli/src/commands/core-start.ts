import { createBinding as createHttpBinding } from "@ucode/binding-http";
import { createBinding as createRpcBinding } from "@ucode/binding-rpc";
import { createBinding as createStdioBinding } from "@ucode/binding-stdio";
import { createBinding as createWsBinding } from "@ucode/binding-ws";
import { createCore } from "@ucode/core";
import type { TransportBinding } from "@ucode/protocol";
import type { CoreStartOptions } from "../options.ts";
import { log, waitForShutdown } from "../runtime.ts";

/**
 * `core start` —— 启动核心层（spec §4.2 的启动流程）。
 *
 * 顺序：openStore（权限/危险文件系统/版本前向拒绝）→ 争 owner → createCore → 选一个绑定 → listen。
 * **stdout 归协议通道**：绑定把协议 C 的线写在 stdout 上，因此这里的日志一律走 stderr。
 */
export async function runCoreStart(options: CoreStartOptions): Promise<number> {
  const core = await createCore({
    dataDir: options.dataDir,
    cwd: options.cwd,
    defaultAutonomy: options.autonomy,
  });

  let binding: TransportBinding;
  switch (options.binding) {
    case "stdio":
      binding = createStdioBinding(core);
      break;
    case "rpc":
      binding = createRpcBinding(core, {
        ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
        host: options.host,
        ...(options.port === undefined ? {} : { port: options.port }),
      });
      break;
    case "http":
      binding = createHttpBinding(core, {
        host: options.host,
        ...(options.port === undefined ? {} : { port: options.port }),
        ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
      });
      break;
    case "ws":
      binding = createWsBinding(core, {
        host: options.host,
        ...(options.port === undefined ? {} : { port: options.port }),
        ...(options.allowNonLoopback ? { allowNonLoopback: true } : {}),
      });
      break;
  }

  await binding.start();
  log(
    `核心层就绪：coreId=${core.coreId} 数据层=${core.dataDir} 绑定=${binding.name}` +
      (binding.endpoint === undefined ? "" : ` 对端=${binding.endpoint}`) +
      ` 信任级别=${binding.trustLevel}`,
  );

  await waitForShutdown();
  log("收到退出信号：释放 owner 租约并关闭会话运行时……");
  await binding.stop();
  await core.close();
  return 0;
}
