/**
 * CLI 的运行时杂务。
 *
 * **stdout 归协议通道**：stdio 绑定下 stdout 是协议 C 的线，任何非协议输出跑到 stdout
 * 都会污染它。所以日志、提示、进度一律写 stderr——这不是风格问题，是正确性问题。
 */

export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** 等一个退出信号；收到后返回，让调用方优雅收尾（释放 owner 租约等）。 */
export function waitForShutdown(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const onSignal = (signal: NodeJS.Signals): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve(signal);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}
