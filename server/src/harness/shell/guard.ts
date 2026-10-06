/**
 * shell 兜底看门狗：给命令加「长时间无输出即中止」与「总时长上限」两层保护。
 *
 * pi 内置的 shell 执行没有默认超时，`stdio` 的 stdin 又是 /dev/null，交互式命令
 * （git 拉编辑器、等待凭据、分页器）会静默挂住整轮对话。这里包在 `BashOperations`
 * 外面，因此不必复制 pi 的进程管理，只在中止时机上补一层判断。
 */
import type { BashOperations } from "@earendil-works/pi-coding-agent";

export type ShellGuardOptions = {
  /** 连续无输出多久判定为空转 */
  idlenessMs: number;
  /** 模型未显式给出 `timeout` 时的总时长上限（秒） */
  defaultTimeoutSeconds: number;
};

/**
 * 空转中止时先写进输出的一行说明：pi 会把已产出的内容拼在错误文案前面，
 * 模型据此知道停下来的原因是等待交互输入，而不是被用户中断。
 */
const idleNotice = (idlenessMs: number): string =>
  `[shell 兜底：该命令已连续 ${Math.round(idlenessMs / 1000)} 秒没有任何输出，判定为在等待交互输入并已中止。` +
  "需要交互的命令请改用非交互参数（例如 git commit -m、git rebase --continue 配 GIT_EDITOR=true），" +
  "不要原样重试；确实长时间静默运行的命令请让它输出进度信息。]\n";

type IdleWatchdog = {
  /** 交给底层执行的信号：用户中断与空转都从这里发出 */
  signal: AbortSignal;
  /** 收到输出即重置计时 */
  reset: () => void;
  /** 这次中止是否由空转触发 */
  hasIdled: () => boolean;
  /** 撤销计时与信号转发 */
  dispose: () => void;
};

/**
 * 空转看门狗。用独立控制器而不是复用外部信号：空转只该终止这一条命令，
 * 不能牵连整轮对话；外部中断则转发过来照常生效（pi 只认传下去的那个信号）。
 */
const createIdleWatchdog = (options: {
  idlenessMs: number;
  external: AbortSignal | undefined;
  notify: (text: string) => void;
}): IdleWatchdog => {
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  if (options.external?.aborted) controller.abort();
  else options.external?.addEventListener("abort", forwardAbort, { once: true });

  let idled = false;
  let timer: NodeJS.Timeout | undefined;
  const reset = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idled = true;
      // 先落说明再中止：顺序反了就拿不到输出通道，模型只看得到「Command aborted」
      options.notify(idleNotice(options.idlenessMs));
      controller.abort();
    }, options.idlenessMs);
    // 看门狗不该拖住进程退出
    timer.unref();
  };

  reset();
  return {
    signal: controller.signal,
    reset,
    hasIdled: () => idled,
    dispose: () => {
      clearTimeout(timer);
      options.external?.removeEventListener("abort", forwardAbort);
    },
  };
};

export const withShellGuard = (
  base: BashOperations,
  options: ShellGuardOptions,
): BashOperations => ({
  exec: async (command, cwd, execOptions) => {
    const watchdog = createIdleWatchdog({
      idlenessMs: options.idlenessMs,
      external: execOptions.signal,
      notify: (text) => execOptions.onData(Buffer.from(text)),
    });

    try {
      return await base.exec(command, cwd, {
        ...execOptions,
        signal: watchdog.signal,
        timeout: execOptions.timeout ?? options.defaultTimeoutSeconds,
        onData: (data) => {
          watchdog.reset();
          execOptions.onData(data);
        },
      });
    } catch (err) {
      // 空转在 pi 侧与「用户中断」共用一个错误消息，这里换回超时语义，免得模型以为是人取消了。
      // 用户中断优先：真被取消时不要报成超时
      const abortedByUser = execOptions.signal?.aborted === true;
      if (
        watchdog.hasIdled() &&
        !abortedByUser &&
        err instanceof Error &&
        err.message === "aborted"
      ) {
        throw new Error(`timeout:${options.idlenessMs / 1000}`);
      }
      throw err;
    } finally {
      watchdog.dispose();
    }
  },
});
