/**
 * agent 侧 shell 的兜底装配：命令预检 + 非交互环境注入 + 空转看门狗 + 默认总时长上限
 * （另有可选的后台服务观测，见 `services.ts`）。
 *
 * 用「同名注册即替换」覆盖 pi 内置的 `bash`（Windows 上还有 `powershell`）：pi 没有执行期钩子，
 * `BashToolOptions` 只能在构造工具时传入，所以只能整体接管这些工具（注册名一致，权限规则与工具集
 * 判定都不受影响）。代价是 pi 设置里的 `shellPath` / `shellCommandPrefix` 不再生效。
 */
import {
  type BashOperations,
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import { SHELL_COMMAND_TIMEOUT_SECONDS, SHELL_IDLE_TIMEOUT_MS } from "../../../constants/tools";
import { withBlockedCommands } from "./blocked";
import { createNonInteractiveSpawnHook } from "./env";
import { withShellGuard } from "./guard";
import { type ServiceWatchHooks, withServiceWatch } from "./services";

/**
 * 给一组本地执行套上约束。顺序有讲究：预检在最外层（命中就直接不进进程，看门狗与环境钩子都省下）；
 * 服务观测夹在本地执行与看门狗之间——拦下的命令不会进探测，而看门狗的超时与中断以异常穿过它，
 * `finally` 里照常结算（覆盖「命令被中止但服务已 detach 存活」）。
 */
const withExecutionGuards = (
  base: BashOperations,
  services: ServiceWatchHooks | undefined,
): BashOperations =>
  withBlockedCommands(
    withShellGuard(services ? withServiceWatch(base, services) : base, {
      idlenessMs: SHELL_IDLE_TIMEOUT_MS,
      defaultTimeoutSeconds: SHELL_COMMAND_TIMEOUT_SECONDS,
    }),
  );

export const createShellExtension =
  (
    input: {
      /** 插件 `bin/` 目录（可信来源），追加到命令的 PATH 末尾 */
      pluginBinDirs?: readonly string[];
      /** 后台服务观测钩子；不给即不探测（子会话、测试与评测脚本） */
      services?: ServiceWatchHooks;
    } = {},
  ): ExtensionFactory =>
  (pi) => {
    // 首参是拿不到会话上下文时的兜底目录；注册工具由 pi 提供 ctx，实际用 ctx.cwd
    const spawnHook = createNonInteractiveSpawnHook(input.pluginBinDirs);
    const bash = createBashToolDefinition(process.cwd(), {
      spawnHook,
      operations: withExecutionGuards(createLocalBashOperations(), input.services),
    });
    pi.registerTool({
      ...bash,
      // 执行约束都是这里注入的，而 pi 的 timeout 参数说明仍写着「没有默认超时」，得补上
      description: withExecutionConstraints(bash.description),
    });

    // Windows 上还有一条执行通道，同样接管：否则默认超时、空转看门狗、非交互环境与插件 `bin/`
    // 在它身上一条都套不上（pi 自带的 powershell 工具只有它自己的默认行为）
    if (process.platform !== "win32") return;
    const powershell = createPowerShellToolDefinition(process.cwd(), {
      spawnHook,
      operations: withExecutionGuards(createLocalPowerShellOperations(), input.services),
    });
    pi.registerTool({
      ...powershell,
      description: withExecutionConstraints(powershell.description),
    });
  };

/** 把服务侧的执行约束接到工具描述末尾：模型只从这个描述知道哪些写法会被拦下或中止 */
const withExecutionConstraints = (description: string | undefined): string => {
  const constraints =
    `未显式指定 timeout 时，命令在 ${SHELL_COMMAND_TIMEOUT_SECONDS} 秒后被中止；` +
    `连续 ${SHELL_IDLE_TIMEOUT_MS / 60_000} 分钟没有输出也会被当作等待交互输入而中止；` +
    "命令里的固定空等（`sleep`）会被拦下，请改用工具自身的等待能力。";

  return description ? `${description} ${constraints}` : constraints;
};
