/**
 * shell 命令预检：把「已知不该执行」的命令挡在进程之前。
 *
 * 起因是会话实测：一轮长任务里 217 步的命令带写死的 `sleep`，累计纯睡 14.6 分钟——等界面稳定、
 * 等服务起监听这类需求本来该由工具自身的等待能力表达（如 agent-browser 的 `wait --load`），
 * 但模型在这之前拿不到「这样等是白等」的信号。与 `guard.ts` 同一套做法：拦下之后先把原因与
 * 替代写法写进输出，而不只是报一句失败。
 *
 * 只做够用的启发式，不解析 shell：`sleep` 必须落在命令位置（行首或 `;` `&` `|` `(` 之后），
 * 因此 `echo "sleep 5"` 这类字面量不会误伤。
 */
import type { BashOperations } from "@earendil-works/pi-coding-agent";

import { SHELL_SLEEP_MIN_SECONDS } from "../../constants";

/** 命令位置的 `sleep <时长>`；时长带可选单位，缺省按秒 */
const SLEEP_PATTERN = /(?:^|[\n;&|(`])\s*sleep\s+(\d+(?:\.\d+)?)([smhd]?)\b/g;

const UNIT_SECONDS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3_600, d: 86_400 };

const toSeconds = (value: string, unit: string): number =>
  Number(value) * (UNIT_SECONDS[unit] ?? UNIT_SECONDS.s ?? 1);

/** 命中就返回给模型的说明，否则返回 null */
export const blockedCommandNotice = (command: string): string | null => {
  for (const match of command.matchAll(SLEEP_PATTERN)) {
    const amount = match[1] ?? "0";
    const unit = match[2] ?? "s";
    if (toSeconds(amount, unit) < SHELL_SLEEP_MIN_SECONDS) continue;
    return (
      `[shell 拦截：命令里的 \`sleep ${amount}${unit}\` 未执行。等界面稳定、等服务就绪、等文件出现` +
      "这类需求请改用工具自身的等待能力（例如 agent-browser 的 `wait --load networkidle`、" +
      '`wait "<选择器>" --state visible`），或把检查写成带重试的命令；确实需要固定空等的场景极少，' +
      "先确认是不是能并行做别的事。]\n"
    );
  }
  return null;
};

export const withBlockedCommands = (base: BashOperations): BashOperations => ({
  exec: async (command, cwd, execOptions) => {
    const notice = blockedCommandNotice(command);
    if (notice) {
      // 输出只有经过 onData 这一路才会出现在工具结果里（见 pi 的 executeBashWithOperations）
      execOptions.onData(Buffer.from(notice));
      return { exitCode: 1 };
    }
    return base.exec(command, cwd, execOptions);
  },
});
