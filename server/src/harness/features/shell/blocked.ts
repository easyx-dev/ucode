/**
 * shell 命令预检：把「已知不该执行」的命令挡在进程之前。
 *
 * 起因是会话实测：一轮长任务里 217 步的命令带写死的 `sleep`，累计纯睡 14.6 分钟——等界面稳定、
 * 等服务起监听这类需求本来该由工具自身的等待能力表达（如浏览器工具打开页面后读当前界面），
 * 但模型在这之前拿不到「这样等是白等」的信号。与 `guard.ts` 同一套做法：拦下之后先把原因与
 * 替代写法写进输出，而不只是报一句失败。
 *
 * 只做够用的启发式，不解析 shell：先摘掉引号包住的片段（`rg 'a; sleep 3'` 这类字面量里的 `;` 不是
 * 命令分隔符），再要求空转命令落在命令位置（行首或 `;` `&` `|` `(` 之后）。规则能一句话说清，
 * 代价是 `bash -c 'sleep 5'` 也一并放过——那种写法下的等待同样该由工具自身表达。
 *
 * posix 的 `sleep` 与 PowerShell / cmd 的写法合成一张表而不按工具分：`sleep` 本就是 PowerShell
 * `Start-Sleep` 的别名，两边都认，分表只会互相漏判。
 */
import type { BashOperations } from "@earendil-works/pi-coding-agent";

import { SHELL_SLEEP_MIN_SECONDS } from "../../../constants/tools";

/** 引号包住的片段；引号内的分隔符与空转命令都不是命令 */
const QUOTED_SEGMENT = /'[^']*'|"[^"]*"/g;

/** 命令位置的 `sleep <时长>`；整条命令文本捕获进第一组，供说明原样引用 */
const POSIX_SLEEP = /(?:^|[\n;&|(`])\s*(sleep\s+(\d+(?:\.\d+)?)([smhd]?))\b/gi;

/** PowerShell 的 `Start-Sleep -Seconds|-Milliseconds <时长>`（`sleep` 是它的别名） */
const POWERSHELL_SLEEP =
  /(?:^|[\n;&|{`])\s*((?:Start-Sleep|sleep)\s+-(Seconds|Milliseconds)\s+(\d+(?:\.\d+)?))(?![-\w])/gi;

/** cmd 的 `timeout /t <秒>`；PowerShell 里调到的也是它 */
const TIMEOUT_COMMAND = /(?:^|[\n;&|{`])\s*(timeout(?:\.exe)?\s+\/t\s+(\d+))(?![-\w])/gi;

const UNIT_SECONDS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3_600, d: 86_400 };

const toSeconds = (value: string, unit: string): number =>
  Number(value) * (UNIT_SECONDS[unit] ?? UNIT_SECONDS.s ?? 1);

/** 一种空转写法：正则给出整条命令文本与折算出的秒数 */
type IdlePattern = {
  pattern: RegExp;
  hit: (match: RegExpMatchArray) => { text: string; seconds: number };
};

const IDLE_PATTERNS: readonly IdlePattern[] = [
  {
    pattern: POSIX_SLEEP,
    hit: (match) => ({
      text: match[1] ?? "",
      seconds: toSeconds(match[2] ?? "0", match[3] ?? "s"),
    }),
  },
  {
    pattern: POWERSHELL_SLEEP,
    hit: (match) => ({
      text: match[1] ?? "",
      // 只有 `-Milliseconds` 要换算，`-Seconds` 与位置参数都按秒
      seconds:
        match[2]?.toLowerCase() === "milliseconds"
          ? Number(match[3] ?? "0") / 1000
          : Number(match[3] ?? "0"),
    }),
  },
  {
    pattern: TIMEOUT_COMMAND,
    hit: (match) => ({ text: match[1] ?? "", seconds: Number(match[2] ?? "0") }),
  },
];

/** 命中就返回给模型的说明，否则返回 null */
export const blockedCommandNotice = (command: string): string | null => {
  // 引号里的内容先摘掉：那里出现的空转命令只是字面量
  const stripped = command.replace(QUOTED_SEGMENT, " ");
  for (const { pattern, hit } of IDLE_PATTERNS) {
    for (const match of stripped.matchAll(pattern)) {
      const { text, seconds } = hit(match);
      if (seconds < SHELL_SLEEP_MIN_SECONDS) continue;
      return (
        `[shell 拦截：命令里的 \`${text || "sleep"}\` 未执行。等界面稳定、等服务就绪、等文件出现` +
        "这类需求请改用工具自身的等待能力（浏览器工具里 browser_open 打开页面后读当前界面、" +
        "browser_snapshot 拿元素），或把检查写成带重试的命令；确实需要固定空等的场景极少，" +
        "先确认是不是能并行做别的事。]\n"
      );
    }
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
