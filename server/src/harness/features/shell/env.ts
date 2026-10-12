/** agent 侧 shell 的非交互环境：覆盖所有会在无 tty 时分页或拉起编辑器的入口 */
import { delimiter } from "node:path";

import type { BashSpawnHook } from "@earendil-works/pi-coding-agent";

/**
 * 覆盖的变量；取值只求「立即返回、不阻塞」。
 * `true` 同时给编辑器与 askpass 用：前者原样接受已有内容（`git rebase --continue` 不再停在编辑界面），
 * 后者产出空输出，让需要人工输入凭据的命令失败。credential helper 先于 askpass 生效，
 * 已存凭据照常可用：这一层挡的是「停下来等输入」，不是「不许访问远端」。
 */
export const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = {
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  EDITOR: "true",
  VISUAL: "true",
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "true",
};

/**
 * 强制覆盖而非补缺省：agent 继承的是服务进程的环境，用户 shell 配置里的
 * EDITOR / PAGER 往往指向 vim / less —— 那正是挂起的来源，不能顺着它。
 */
export const withNonInteractiveEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  ...NON_INTERACTIVE_ENV,
});

/**
 * 把插件 `bin/` 目录追加到 PATH 末尾：只影响这条命令的环境，不动服务进程。
 * 追加而非前置，系统命令与用户自己的 PATH 顺序都不受扰动。
 */
export const withPluginPath = (
  env: NodeJS.ProcessEnv,
  dirs: readonly string[],
): NodeJS.ProcessEnv => {
  if (dirs.length === 0) return env;
  const current = env.PATH ?? "";
  const appended = dirs.join(delimiter);
  return { ...env, PATH: current ? `${current}${delimiter}${appended}` : appended };
};

/** spawn 钩子：命令执行前合并非交互环境，并追加插件 bin 目录 */
export const createNonInteractiveSpawnHook =
  (pluginBinDirs: readonly string[] = []): BashSpawnHook =>
  (context) => ({
    ...context,
    env: withPluginPath(withNonInteractiveEnv(context.env), pluginBinDirs),
  });
