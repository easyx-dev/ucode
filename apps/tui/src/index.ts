import { type AgentSdk, type Capability, connect, type Transport } from "@ucode/sdk";
import { createClient as createHttpClient } from "@ucode/sdk/http";
import { createClient as createRpcClient } from "@ucode/sdk/rpc";
import { createClient as createStdioClient } from "@ucode/sdk/stdio";
import { runPiTui } from "./app.ts";

/**
 * TUI 壳入口：把"怎么连上核心层"与"界面长什么样"分开。
 *
 * 控制层声明自己**能承载**四种阻塞式交互（select/confirm/input/editor），
 * 核心层据此按信任矩阵授予 `interaction.respond`——这就是"能力声明与能力授予分离"的实际用处：
 * 一个只会展示不会应答的壳子声明得少，就不会收到它处理不了的请求。
 *
 * 界面复用基座 `@earendil-works/pi-tui` 的组件层（见 app.ts / view.ts）；
 * 本包由 Node 直接执行（源码直出），因此**只用 `.ts`、不用 JSX**。
 */
export type TuiLaunchOptions = {
  productName: string;
  /** 自己拉起核心层（stdio）。 */
  spawnCore?: { command: string; args: string[]; cwd?: string };
  /** 或者连一个已经在跑的。 */
  endpoint?:
    | { kind: "rpc"; socketPath?: string; host?: string; port?: number }
    | { kind: "http"; baseUrl: string };
  capabilities?: Capability[];
};

const DEFAULT_CAPABILITIES: Capability[] = [
  "sessions.read",
  "sessions.write",
  "prompt.run",
  "tools.direct",
  "interaction.respond",
  "autonomy.unattended",
  "channel.workspace",
];

export async function runTui(options: TuiLaunchOptions): Promise<number> {
  const transport = buildTransport(options);
  const sdk: AgentSdk = await connect({
    transport,
    clientKind: "tui",
    capabilities: options.capabilities ?? DEFAULT_CAPABILITIES,
  });

  try {
    await sdk.connect();
  } catch (error) {
    process.stderr.write(
      `连接核心层失败：${error instanceof Error ? error.message : String(error)}\n`,
    );
    await sdk.close();
    return 1;
  }

  let closed = false;
  /** 关一次就够了：sdk.close() 会终止自己拉起的核心层进程。 */
  const closeOnce = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await sdk.close().catch(() => undefined);
  };

  // 被信号打断时也要回收子进程。少了这一步，被 kill 掉的 TUI 会留下一个仍在跑的
  // 核心层——它继续持有会话的 owner 租约，下一次启动就只能只读挂载（表现为"发消息没反应"）。
  const onSignal = (): void => {
    void closeOnce().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    return await runPiTui({ sdk, productName: options.productName });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await closeOnce();
  }
}

function buildTransport(options: TuiLaunchOptions): Transport {
  if (options.endpoint !== undefined) {
    if (options.endpoint.kind === "http") {
      return createHttpClient({ baseUrl: options.endpoint.baseUrl, clientId: "tui" });
    }
    return createRpcClient({
      ...(options.endpoint.socketPath === undefined
        ? {}
        : { socketPath: options.endpoint.socketPath }),
      ...(options.endpoint.host === undefined ? {} : { host: options.endpoint.host }),
      ...(options.endpoint.port === undefined ? {} : { port: options.endpoint.port }),
    });
  }
  if (options.spawnCore === undefined) {
    throw new Error("必须给出 spawnCore 或 endpoint 之一。");
  }
  return createStdioClient({
    command: options.spawnCore.command,
    args: options.spawnCore.args,
    ...(options.spawnCore.cwd === undefined ? {} : { cwd: options.spawnCore.cwd }),
  });
}

export { runPiTui } from "./app.ts";
