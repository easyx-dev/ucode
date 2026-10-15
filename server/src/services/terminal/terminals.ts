/**
 * 终端的进程内运行态：按归属键归口的 PTY 池。
 *
 * 池不关心会话跑在哪里——它只认一个归属键与一份启动参数（`TerminalSpawnSpec`），
 * 「用哪个目录、哪个 shell、上限多少」都在同目录的 `index.ts` 里定。所以同一份池既不假设
 * 自己是本地终端，也不需要为别的会话形态改结构：外层仍是本地 PTY 的远端会话（如 `ssh -tt <host>`）
 * 只是另一份参数。归属键现在是工作目录（同目录的会话共用同一批终端，与工作台的文件树 / git 同口径），
 * 将来真出现按主机归口的会话时，要改的是这个键的算法与 `list` / `countRunning` 的过滤。
 *
 * 终端不属于某个会话，也不落盘：服务重启即消失。它是有状态的那一半（进程、订阅者、回放缓冲），池本身不读配置。
 *
 * 输出收在这里合批再分发：PTY 的分片很碎，逐片发会把连接与前端渲染压满。
 * 每个终端的最近输出留一份环形缓冲，供新订阅者（刷新页面、换端）把屏幕填回来。
 */
import { randomUUID } from "node:crypto";
import type { TerminalInfo } from "@ucode/contracts";

import * as pty from "node-pty";

import { logger } from "../../platform/logger";

/** 起一个终端所需的全部参数；shell 与 env 由 services 层决定 */
export type TerminalSpawnSpec = {
  /** shell 可执行文件 */
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
};

export type TerminalPoolOptions = {
  /** 每个工作目录下的终端数上限 */
  maxPerCwd: number;
  /** 每个终端保留的可回放输出上限（字节） */
  scrollbackBytes: number;
  /** 输出合批窗口（毫秒） */
  flushMs: number;
};

/**
 * 订阅者只做一件事：把字节与结束信号交给自己的输出端（WS 连接）。
 * 抛错不会拖垮其它订阅者；`onExit` 在**进程结束**与**终端被关闭**两种情况下都会来一次，
 * 所以订阅端不必自己判断「对端是不是悄悄没了」。
 */
export type TerminalSubscriber = {
  onData: (chunk: Buffer) => void;
  onExit: (exitCode: number) => void;
};

type TerminalEntry = {
  id: string;
  /** 该终端在归属键下的创建序号（不回收）：界面靠它稳定地区分多个终端 */
  sequence: number;
  /** 归属键（当前即工作目录）：同键的会话视作同一批，`list` / `countRunning` 按它过滤 */
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  pid: number;
  createdAt: string;
  process: pty.IPty;
  /** 最近输出（时间序）；`bufferBytes` 是它们的实际字节数，用于裁剪 */
  buffer: Buffer[];
  bufferBytes: number;
  /** 等待合批的输出分片 */
  pending: Buffer[];
  flushTimer: NodeJS.Timeout | null;
  subscribers: Set<TerminalSubscriber>;
  /** 退出码；仍在运行时为 null */
  exitCode: number | null;
};

export class TerminalPool {
  private readonly entries = new Map<string, TerminalEntry>();
  /** 归属键 → 已发出去的序号；只增不减，关掉中间一个也不会让后面的序号前移 */
  private readonly sequences = new Map<string, number>();

  constructor(private readonly options: TerminalPoolOptions) {}

  /** 起一个终端；调用方负责上限与 cwd 校验 */
  create(input: {
    cwd: string;
    cols: number;
    rows: number;
    spec: TerminalSpawnSpec;
  }): TerminalInfo {
    const id = randomUUID();
    const process_ = pty.spawn(input.spec.file, [...input.spec.args], {
      // name 即子进程看到的 TERM
      name: "xterm-256color",
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env: input.spec.env,
    });

    const sequence = (this.sequences.get(input.cwd) ?? 0) + 1;
    this.sequences.set(input.cwd, sequence);

    const entry: TerminalEntry = {
      id,
      sequence,
      cwd: input.cwd,
      shell: input.spec.file,
      cols: input.cols,
      rows: input.rows,
      pid: process_.pid,
      createdAt: new Date().toISOString(),
      process: process_,
      buffer: [],
      bufferBytes: 0,
      pending: [],
      flushTimer: null,
      subscribers: new Set(),
      exitCode: null,
    };
    this.entries.set(id, entry);

    process_.onData((data) => this.push(entry, Buffer.from(data, "utf8")));
    process_.onExit(({ exitCode }) => {
      // 已经被 close / disposeAll 摘掉的终端不再广播：那条路径在 dispose 里已经发过结束了
      if (this.entries.get(id) !== entry) return;
      this.flush(entry);
      entry.exitCode = exitCode;
      this.notifyExit(entry, exitCode);
    });

    return toInfo(entry);
  }

  get(id: string): TerminalInfo | null {
    const entry = this.entries.get(id);
    return entry ? toInfo(entry) : null;
  }

  /** 某个工作目录下的终端，按创建时间先后（表的插入序即创建序） */
  list(cwd: string): TerminalInfo[] {
    const result: TerminalInfo[] = [];
    for (const entry of this.entries.values()) {
      if (entry.cwd === cwd) result.push(toInfo(entry));
    }
    return result;
  }

  /** 该工作目录下仍在运行的终端数（上限按它判；已退出的条目不算） */
  countRunning(cwd: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.cwd === cwd && entry.exitCode === null) count += 1;
    }
    return count;
  }

  /** 写入用户输入；终端不在或已退出时返回 false */
  write(id: string, data: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.exitCode !== null) return false;
    entry.process.write(data);
    return true;
  }

  /** 改尺寸；终端不在或已退出时返回 null */
  resize(id: string, cols: number, rows: number): { cols: number; rows: number } | null {
    const entry = this.entries.get(id);
    if (!entry || entry.exitCode !== null) return null;
    entry.process.resize(cols, rows);
    entry.cols = cols;
    entry.rows = rows;
    return { cols, rows };
  }

  /** 可回放的输出（时间序）；终端不存在时返回 null */
  snapshot(id: string): Buffer[] | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return [...entry.buffer];
  }

  /**
   * 订阅输出。返回退订函数；终端不存在时返回 null（调用方据此报 `terminal_not_found`）。
   * 重放需要「快照 + 订阅」两步不漏，所以调用方要在**同一个同步块**里先取 `snapshot()` 再调这里：
   * 中间不插 await 就不会漏掉这期间的新输出（服务的输出不是同步发生的）。
   */
  subscribe(id: string, subscriber: TerminalSubscriber): (() => void) | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    entry.subscribers.add(subscriber);
    return () => {
      entry.subscribers.delete(subscriber);
    };
  }

  /** 关掉一个终端（杀进程并摘除条目）；终端不存在时返回 false */
  close(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.dispose(entry);
    return true;
  }

  /** 服务退出时清场：不留任何 PTY 子进程 */
  disposeAll(): void {
    for (const entry of [...this.entries.values()]) this.dispose(entry);
  }

  /** 追加一段输出：先攒进待合批队列，到点合并成一片 */
  private push(entry: TerminalEntry, chunk: Buffer): void {
    entry.pending.push(chunk);
    if (entry.flushTimer) return;
    entry.flushTimer = setTimeout(() => {
      entry.flushTimer = null;
      this.flush(entry);
    }, this.options.flushMs);
    // 定时器不该拖住进程退出：真正的清场在 disposeAll
    entry.flushTimer.unref();
  }

  /** 合批成一片再分发：一片让接收端少写几次 */
  private flush(entry: TerminalEntry): void {
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = null;
    }
    if (entry.pending.length === 0) return;
    const chunk = Buffer.concat(entry.pending);
    entry.pending = [];
    if (chunk.length === 0) return;

    this.remember(entry, chunk);
    for (const subscriber of entry.subscribers) {
      try {
        subscriber.onData(chunk);
      } catch (error) {
        // 一个订阅者写失败不该影响其它订阅者；它自己的收尾由那侧负责
        logger.warn({ err: error, terminalId: entry.id }, "终端订阅者接收输出失败");
      }
    }
  }

  /** 记进环形缓冲，超出上限从头丢 */
  private remember(entry: TerminalEntry, chunk: Buffer): void {
    entry.buffer.push(chunk);
    entry.bufferBytes += chunk.length;
    while (entry.bufferBytes > this.options.scrollbackBytes && entry.buffer.length > 1) {
      const dropped = entry.buffer.shift();
      entry.bufferBytes -= dropped?.length ?? 0;
    }
  }

  private notifyExit(entry: TerminalEntry, exitCode: number): void {
    for (const subscriber of entry.subscribers) {
      try {
        subscriber.onExit(exitCode);
      } catch (error) {
        logger.warn({ err: error, terminalId: entry.id }, "终端订阅者收尾失败");
      }
    }
  }

  /**
   * 摘掉一个终端。**先发结束信号再清订阅者**：被关闭时订阅端也要知道「到此为止」，
   * 否则它那条连接会一直挂着等一个永远不来的输出（关闭是用户动作，进程的 onExit 不会再来）。
   */
  private dispose(entry: TerminalEntry): void {
    this.entries.delete(entry.id);
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = null;
    }
    this.flush(entry);
    this.notifyExit(entry, entry.exitCode ?? 0);
    entry.subscribers.clear();
    try {
      entry.process.kill();
    } catch (error) {
      // 进程已经自己退出了：kill 一个已死的 pty 会抛，这里不是异常情况
      logger.debug({ err: error, terminalId: entry.id }, "终端进程结束前已被回收");
    }
  }
}

const toInfo = (entry: TerminalEntry): TerminalInfo => ({
  id: entry.id,
  sequence: entry.sequence,
  cwd: entry.cwd,
  shell: entry.shell,
  cols: entry.cols,
  rows: entry.rows,
  running: entry.exitCode === null,
  pid: entry.pid,
  exitCode: entry.exitCode,
  createdAt: entry.createdAt,
});
