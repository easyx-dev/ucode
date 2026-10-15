/**
 * 终端用例编排：定工作目录、定 shell、守上限，把 PTY 池（同目录的 `terminals.ts`）接给路由，
 * 并保管输出流的握手票（同目录的 `tickets.ts`）。
 *
 * 终端按**工作目录**归口（同目录的会话共用同一批终端，与工作台的文件树 / git 同口径），
 * 所以每次请求都先把「会话 id 或目录」解析成那个目录：会话走它的工作目录（未绑定目录的会话
 * 用它自己的工作区），草稿态直接给目录。解析产物用 realpath 归一，避免同一目录的不同写法
 * 分裂成两批终端。
 */
import { existsSync, mkdirSync } from "node:fs";

import {
  ERROR_CODES,
  TERMINAL_COLS_MAX,
  TERMINAL_COLS_MIN,
  TERMINAL_ROWS_MAX,
  TERMINAL_ROWS_MIN,
  type TerminalCloseInput,
  type TerminalCloseResponse,
  type TerminalCreateInput,
  type TerminalCreateResponse,
  type TerminalInfo,
  type TerminalListInput,
  type TerminalListResponse,
  type TerminalResizeInput,
  type TerminalResizeResponse,
  type TerminalTicketResponse,
} from "@ucode/contracts";

import {
  TERMINAL_MAX_PER_CWD,
  TERMINAL_OUTPUT_FLUSH_MS,
  TERMINAL_SCROLLBACK_BYTES,
} from "../../constants/terminal";
import { resolveSessionCwd } from "../../core/session-paths";
import { isWorkspaceCwd } from "../../core/workspace";
import type { SessionRepository } from "../../db/session-repository";
import { env } from "../../env";
import { resolveExistingPath, resolveTargetPath } from "../../platform/paths";
import { AppError } from "../../platform/response";
import { TerminalPool, type TerminalSpawnSpec } from "./terminals";
import { TerminalTicketStore } from "./tickets";

/** 输出流那侧要用的接缝：订阅者拿字节与结束信号，不关心它是 HTTP 还是 WS */
export type TerminalSubscriber = {
  onData: (chunk: Buffer) => void;
  onExit: (exitCode: number) => void;
};

export type TerminalService = {
  create(input: TerminalCreateInput): TerminalCreateResponse;
  list(input: TerminalListInput): TerminalListResponse;
  resize(input: TerminalResizeInput): TerminalResizeResponse;
  close(input: TerminalCloseInput): TerminalCloseResponse;
  /** 写入用户输入（WS 上行）；终端不在或已退出时返回 false */
  write(id: string, data: string): boolean;
  /** 终端视图；不存在时为 null（路由据此区分「空缓冲」与「不存在的终端」） */
  get(id: string): TerminalInfo | null;
  /** 当前可回放的输出（时间序）；终端不存在时为 null */
  snapshot(id: string): Buffer[] | null;
  /** 订阅输出；终端不存在时为 null */
  subscribe(id: string, subscriber: TerminalSubscriber): (() => void) | null;
  /** 给输出流签一张一次性握手票；终端不存在时为 null */
  issueTicket(id: string): TerminalTicketResponse | null;
  /** 核销握手票，返回它绑定的终端 id；无效、过期或已用过时为 null */
  redeemTicket(ticket: string): string | null;
  /** 预检握手票（不消耗）：鉴权中间件用它决定是否放行这条升级请求 */
  peekTicket(ticket: string, terminalId: string): boolean;
  /** 服务退出时清场 */
  disposeAll(): void;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(Math.trunc(value), min), max);

/**
 * 终端跑哪个 shell：POSIX 取用户的 `$SHELL`，Windows 取 `ComSpec`。
 * POSIX 传 `-l`（登录 shell）——本服务多从 GUI / 后台起，进程的 PATH 里常缺用户自己装的目录。
 * `COLORTERM` 交给 truecolor：xterm 6 认 24 位色，不给的话不少程序只肯出 8 色。
 */
const shellSpecOf = (): TerminalSpawnSpec => {
  const env_ = { ...process.env, COLORTERM: "truecolor" };
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec?.trim();
    return { file: comspec && comspec.length > 0 ? comspec : "cmd.exe", args: [], env: env_ };
  }
  const shell = process.env.SHELL?.trim();
  return { file: shell && shell.length > 0 ? shell : "/bin/bash", args: ["-l"], env: env_ };
};

/** 请求里的目标目录（未归一）：会话走它的工作目录，否则用显式给的目录 */
const targetDirOf = (
  input: { sessionId?: string | undefined; cwd?: string | undefined },
  sessions: SessionRepository,
): string => {
  if (input.sessionId) {
    const record = sessions.find(input.sessionId);
    if (!record) {
      throw new AppError(ERROR_CODES.notFound, `会话不存在：${input.sessionId}`, 404);
    }
    return resolveSessionCwd(record);
  }
  return input.cwd ?? env.workspacesDir;
};

/**
 * 归一成一个真实目录路径，作为终端归口的键。目录不存在或不是目录时返回 null，
 * 由调用方决定是报错（创建）还是当作「没有终端」（列举）。
 */
const existingDirKeyOf = (dir: string): string | null => {
  try {
    return resolveExistingPath(dir);
  } catch {
    return null;
  }
};

export const createTerminalService = (deps: { sessions: SessionRepository }): TerminalService => {
  const pool = new TerminalPool({
    maxPerCwd: TERMINAL_MAX_PER_CWD,
    scrollbackBytes: TERMINAL_SCROLLBACK_BYTES,
    flushMs: TERMINAL_OUTPUT_FLUSH_MS,
  });
  const tickets = new TerminalTicketStore();

  /** 创建时要落在一个真目录上：工作区目录（服务自己分配的）缺了就建，用户目录缺了就是错误 */
  const createDirOf = (input: TerminalCreateInput): string => {
    const target = resolveTargetPath(targetDirOf(input, deps.sessions));
    if (!existsSync(target)) {
      if (!isWorkspaceCwd(target, env.workspacesDir)) {
        throw new AppError(ERROR_CODES.pathNotFound, `目录不存在：${target}`, 400, undefined, {
          path: target,
        });
      }
      mkdirSync(target, { recursive: true });
    }
    const key = existingDirKeyOf(target);
    if (!key) {
      throw new AppError(ERROR_CODES.pathNotFound, `不是可用的目录：${target}`, 400, undefined, {
        path: target,
      });
    }
    return key;
  };

  const infoOrThrow = (id: string): TerminalInfo => {
    const info = pool.get(id);
    if (!info) {
      throw new AppError(ERROR_CODES.terminalNotFound, `终端不存在或已结束：${id}`, 404);
    }
    return info;
  };

  return {
    create(input) {
      const cwd = createDirOf(input);
      if (pool.countRunning(cwd) >= TERMINAL_MAX_PER_CWD) {
        throw new AppError(
          ERROR_CODES.terminalLimit,
          `该目录下的终端数已达上限（${TERMINAL_MAX_PER_CWD}）`,
          400,
          undefined,
          { path: cwd },
        );
      }
      return pool.create({
        cwd,
        cols: clamp(input.cols, TERMINAL_COLS_MIN, TERMINAL_COLS_MAX),
        rows: clamp(input.rows, TERMINAL_ROWS_MIN, TERMINAL_ROWS_MAX),
        spec: shellSpecOf(),
      });
    },

    list(input) {
      // 目录不在（如工作区还没建）就是「没有终端」，不是错误
      const cwd = existingDirKeyOf(resolveTargetPath(targetDirOf(input, deps.sessions)));
      return { terminals: cwd ? pool.list(cwd) : [] };
    },

    resize(input) {
      const info = infoOrThrow(input.terminalId);
      const size = pool.resize(
        input.terminalId,
        clamp(input.cols, TERMINAL_COLS_MIN, TERMINAL_COLS_MAX),
        clamp(input.rows, TERMINAL_ROWS_MIN, TERMINAL_ROWS_MAX),
      );
      // 进程已结束时不再有尺寸可改，回它最后的尺寸，调用方据此收敛
      return size ?? { cols: info.cols, rows: info.rows };
    },

    close(input) {
      return { closed: pool.close(input.terminalId) };
    },

    write: (id, data) => pool.write(id, data),
    get: (id) => pool.get(id),
    snapshot: (id) => pool.snapshot(id),
    subscribe: (id, subscriber) => pool.subscribe(id, subscriber),

    issueTicket(id) {
      return pool.get(id) ? tickets.issue(id) : null;
    },

    redeemTicket: (ticket) => tickets.redeem(ticket),
    peekTicket: (ticket, terminalId) => tickets.peek(ticket, terminalId),
    disposeAll: () => pool.disposeAll(),
  };
};
