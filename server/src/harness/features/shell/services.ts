/**
 * 后台服务观测：从命令与输出里找端口线索，用「执行前不可连、执行后能连」判定这条命令起了哪个服务。
 *
 * pi 的 `BashOperations` 只透传 `exec(command, cwd, options)`，pid 只用于它内部的 `killProcessTree`
 * 且未对外导出，「哪个进程是这次命令起的」在进程关系上归因不了，只能从可观测的外部效果归因
 * ——端口是最稳的那个。探测只连回环地址：域名与公网 IP 一律丢弃，不产生任何对外连接。
 */
import { createConnection } from "node:net";

import type { BashOperations } from "@earendil-works/pi-coding-agent";

import {
  SERVICE_OUTPUT_CAPTURE_MAX_BYTES,
  SERVICE_PROBE_RETRY_INTERVAL_MS,
  SERVICE_PROBE_RETRY_WINDOW_MS,
  SERVICE_PROBE_TIMEOUT_MS,
} from "../../../constants/tools";
import { logger } from "../../../platform/logger";

/** 一次命中：某条命令起了某个回环端口上的服务 */
export type ServiceObservation = {
  /** 命令原文 */
  command: string;
  /** 命令的工作目录 */
  cwd: string;
  /** 观测到可连的端口 */
  port: number;
};

/** 装配层注入的观测入口；不给钩子就完全不探测（子会话、测试与评测脚本） */
export type ServiceWatchHooks = {
  observe: (observation: ServiceObservation) => void;
};

const MAX_PORT = 65_535;

/** `scheme://host:port`；host 还要过回环判定 */
const URL_PORT = /\b[a-z][\w+.-]*:\/\/([\w.-]+|\[[0-9a-fA-F:]+\]):(\d{1,5})\b/gi;

/**
 * 裸 `host:port`：只认回环主机名。不这样限制的话 `12:30`、`a:b` 这类都会被当成端口，
 * 而「正文里的数字不被误认成端口」正是这里要守住的。
 */
const HOST_PORT = /(?<=^|[\s"'=([,-])([\w.-]+):(\d{1,5})\b/gi;

/** 显式端口参数：`--port 3000` / `--port=3000` / `PORT=3000` / `port 3000` */
const PORT_FLAG = /(?:--port[=\s]+|PORT=|\bport\s+)(\d{1,5})\b/gi;

/**
 * 独立成词的 4–5 位数字：`http.server 45678` / `-p 3000` 这类「端口只是个位置参数」的写法
 * 只能靠它认出来。放宽的代价只是多探几个回环端口：记一条仍要求「执行前不可连 ∧ 执行后能连」，
 * 所以 `kill -9 12345`、`--max-old-space-size=4096` 这些被误认的例子不会变成一条服务。
 */
const BARE_PORT = /(?<![\w.:-])(\d{4,5})(?![\w.])/g;

/** 服务端口的取值下限：1024 以下系统不分配给普通服务 */
const MIN_SERVICE_PORT = 1024;

const LOOPBACK_HOSTS = new Set(["localhost", "0.0.0.0", "::1", "::"]);

const isValidPort = (port: number): boolean =>
  Number.isInteger(port) && port > 0 && port <= MAX_PORT;

export const isLoopbackHost = (host: string): boolean => {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return normalized.startsWith("127.") || LOOPBACK_HOSTS.has(normalized);
};

/** 文本里的端口线索，按出现顺序去重 */
const collectPorts = (text: string): number[] => {
  const ports: number[] = [];
  const keep = (raw: string | undefined): void => {
    const port = Number(raw);
    if (isValidPort(port) && !ports.includes(port)) ports.push(port);
  };

  for (const match of text.matchAll(URL_PORT)) {
    if (isLoopbackHost(match[1] ?? "")) keep(match[2]);
  }
  for (const match of text.matchAll(HOST_PORT)) {
    if (isLoopbackHost(match[1] ?? "")) keep(match[2]);
  }
  for (const match of text.matchAll(PORT_FLAG)) keep(match[1]);

  return ports;
};

/** 命令里的端口线索：显式参数、写出来的回环地址，以及独立成词的 4–5 位数字 */
export const portsFromCommand = (command: string): number[] => {
  const ports = collectPorts(command);
  for (const match of command.matchAll(BARE_PORT)) {
    const port = Number(match[1]);
    if (port < MIN_SERVICE_PORT || !isValidPort(port) || ports.includes(port)) continue;
    ports.push(port);
  }
  return ports;
};

/** 输出里的端口线索：服务自己打印的地址（`Local:   http://localhost:5173/`） */
export const portsFromOutput = (output: string): number[] => collectPorts(output);

/** 探一次回环端口：能建立连接即为「在监听」；出错与超时都算不可连 */
export const probePort = (port: number, timeoutMs = SERVICE_PROBE_TIMEOUT_MS): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

/**
 * 执行后的探测：在窗口内按间隔重试。
 *
 * 单次探测不够用——`pnpm dev &` 这类命令立即返回，服务往往在几百毫秒后才 listen，
 * 一次连不上就判「没起服务」，最常见的用法恰好被漏掉。
 */
const probeUntilOpen = async (port: number): Promise<boolean> => {
  const deadline = Date.now() + SERVICE_PROBE_RETRY_WINDOW_MS;
  for (;;) {
    if (await probePort(port)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, SERVICE_PROBE_RETRY_INTERVAL_MS));
  }
};

type SettleInput = {
  command: string;
  cwd: string;
  /** 执行前发起的探测，按端口索引 */
  preProbes: Map<number, Promise<boolean>>;
  /** 旁路保留的命令输出 */
  output: string;
  hooks: ServiceWatchHooks;
};

/** 结算：只有「执行前不可连、执行后能连」的端口才算本次命令起的服务 */
const settle = async ({ command, cwd, preProbes, output, hooks }: SettleInput): Promise<void> => {
  // 命令线索带执行前基线：挡住「探到别人已经在跑的服务」这一类误报
  const commandHits = [...preProbes].map(async ([port, pre]) => {
    if (await pre) return null;
    return (await probeUntilOpen(port)) ? port : null;
  });
  // 输出线索是「端口只在运行期才知道」的必要来源——`npm run dev` 的端口写在 package.json 里，
  // 命令文本里没有它。没有执行前基线可比，只在可连时归本次命令。
  const outputHits = portsFromOutput(output)
    .filter((port) => !preProbes.has(port))
    .map(async (port) => ((await probeUntilOpen(port)) ? port : null));

  for (const port of await Promise.all([...commandHits, ...outputHits])) {
    if (port === null) continue;
    hooks.observe({ command, cwd, port });
  }
};

/**
 * 给本地执行加一层服务观测。
 *
 * 装在本地执行之外、看门狗之内（见 `shell/index.ts` 的流水线）：命令被拦下时根本不进这里，
 * 而看门狗的超时与中断以异常穿过本层，`finally` 里照常结算——正好覆盖「命令被中止但服务已 detach 存活」。
 */
export const withServiceWatch = (
  base: BashOperations,
  hooks: ServiceWatchHooks,
): BashOperations => ({
  exec: async (command, cwd, execOptions) => {
    // 「执行前」探测立刻发起：命令可能在它返回前就结束（如 `echo`），等命令结束再探已经晚了
    const preProbes = new Map(portsFromCommand(command).map((port) => [port, probePort(port)]));
    const chunks: Buffer[] = [];
    let captured = 0;

    try {
      return await base.exec(command, cwd, {
        ...execOptions,
        onData: (data) => {
          // 旁路一份输出只为找端口线索：超限即停止累积，转发给 pi 的那一路不受影响
          if (captured + data.length <= SERVICE_OUTPUT_CAPTURE_MAX_BYTES) {
            chunks.push(data);
            captured += data.length;
          }
          execOptions.onData(data);
        },
      });
    } finally {
      // 结算绝不阻塞 exec 返回：拖慢它等于拖慢工具结果进上下文；异常路径（超时 / 中断）也走这里，
      // 正好覆盖「命令被中止但服务已 detach 存活」。
      //
      // 必须自己捉住失败：结算在微任务里跑，上游（pi 的工具执行、HTTP 处理）的 try/catch 够不到它，
      // 而未捕获的 rejection 在 Node 默认会直接结束进程
      void settle({
        command,
        cwd,
        preProbes,
        output: Buffer.concat(chunks).toString("utf8"),
        hooks,
      }).catch((error: unknown) => logger.warn({ error, command }, "后台服务结算失败"));
    }
  },
});
