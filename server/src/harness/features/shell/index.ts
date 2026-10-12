/**
 * agent 侧 shell 的兜底装配：命令预检 + 非交互环境注入 + 空转看门狗 + 默认总时长上限。
 *
 * 用「同名注册即替换」覆盖 pi 内置的 `bash`：pi 没有执行期钩子，`BashToolOptions`
 * 只能在构造工具时传入，所以只能整体接管这个工具（注册名一致，权限规则与工具集
 * 判定都不受影响）。代价是 pi 设置里的 `shellPath` / `shellCommandPrefix` 不再生效。
 */
import {
  createBashToolDefinition,
  createLocalBashOperations,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import { SHELL_COMMAND_TIMEOUT_SECONDS, SHELL_IDLE_TIMEOUT_MS } from "../../../constants/tools";
import { withBlockedCommands } from "./blocked";
import { createNonInteractiveSpawnHook } from "./env";
import { withShellGuard } from "./guard";

export const createShellExtension =
  (
    input: {
      /** 插件 `bin/` 目录（可信来源），追加到命令的 PATH 末尾 */
      pluginBinDirs?: readonly string[];
    } = {},
  ): ExtensionFactory =>
  (pi) => {
    // 首参是拿不到会话上下文时的兜底目录；注册工具由 pi 提供 ctx，实际用 ctx.cwd
    const definition = createBashToolDefinition(process.cwd(), {
      spawnHook: createNonInteractiveSpawnHook(input.pluginBinDirs),
      // 预检在最外层：命中就直接不进进程，看门狗与环境钩子都省下
      operations: withBlockedCommands(
        withShellGuard(createLocalBashOperations(), {
          idlenessMs: SHELL_IDLE_TIMEOUT_MS,
          defaultTimeoutSeconds: SHELL_COMMAND_TIMEOUT_SECONDS,
        }),
      ),
    });

    pi.registerTool({
      ...definition,
      // 执行约束都是这里注入的，而 pi 的 timeout 参数说明仍写着「没有默认超时」，得补上
      description: withExecutionConstraints(definition.description),
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
