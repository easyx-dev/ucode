import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import type { ServerMessage, TrustLevel } from "@ucode/protocol";
import { type IPty, spawn as spawnPty } from "node-pty";

/**
 * PTY 字节流通道（spec §4.7 第 2 条，V-7 已验证）。
 *
 * 终端仿真需要双向字节流 + 窗口尺寸变更 + 信号，塞进 JSON 消息面会毁掉体验；
 * 因此走**通道帧**：字节用 base64（JSON 里放不下裸字节），一帧一推。
 *
 * 通道是服务层持有的一等概念：一条通道一个 PTY，随连接断开而关闭（防孤儿 shell）。
 */

export type PtyChannel = {
  readonly channelId: string;
  /** PTY 输出 → 控制层（base64）。 */
  onData: (handler: (message: ServerMessage) => void) => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  signal(name: string): void;
  close(): void;
};

export type PtyOpenParams = {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
};

export function openPtyChannel(
  channelId: string,
  params: PtyOpenParams,
  trustLevel: TrustLevel,
  send: (message: ServerMessage) => void,
  onExit: (channelId: string, exitCode: number) => void,
): PtyChannel {
  // 非环回通路上的 PTY = 在服务器上开一个交互式 shell：只有本机等价通路可用（spec §2.3）
  if (trustLevel === "untrusted") {
    throw new Error("untrusted 通路不能打开 PTY 通道（会在主机上执行交互式程序）。");
  }

  const cols = params.cols ?? 80;
  const rows = params.rows ?? 24;
  const shell = params.shell ?? process.env.SHELL ?? "/bin/zsh";
  const pty: IPty = spawnPty(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: params.cwd ?? homedir(),
    env: { ...process.env, TERM: "xterm-256color", ...(params.env ?? {}) } as Record<
      string,
      string
    >,
  });

  const handlers: ((message: ServerMessage) => void)[] = [];
  let closed = false;

  pty.onData((data: string) => {
    if (closed) return;
    const message: ServerMessage = {
      type: "channel.data",
      channelId,
      data: Buffer.from(data, "utf8").toString("base64"),
    };
    for (const handler of handlers) handler(message);
  });
  pty.onExit(({ exitCode }) => {
    // 进程退出**必须**通知（控制层靠它收起终端面板）——即使退出是我们自己 close() 触发的：
    // close() 只表示"服务层不再转发数据"，不代表控制层收到了结束信号。
    closed = true;
    send({ type: "channel.event", channelId, event: { kind: "exit", exitCode } });
    send({ type: "channel.closed", channelId, reason: `进程退出（code=${exitCode}）` });
    onExit(channelId, exitCode);
  });

  return {
    channelId,
    onData: (handler) => {
      handlers.push(handler);
    },
    write(data) {
      if (closed) return;
      pty.write(Buffer.from(data, "base64").toString("utf8"));
    },
    resize(cols2, rows2) {
      if (closed) return;
      try {
        pty.resize(cols2, rows2);
      } catch {
        // 进程已退出的 resize 会抛错：忽略（终端语义里无害）
      }
    },
    signal(name) {
      if (closed) return;
      if (name === "SIGINT") pty.write("\u0003");
      else if (name === "SIGTSTP") pty.write("\u001a");
      else pty.kill(name);
    },
    close() {
      if (closed) return;
      closed = true;
      pty.kill();
    },
  };
}

/** 通道 id：core 内唯一即可（消息里带 channelId 寻址）。 */
export function newChannelId(): string {
  return `pty-${randomBytes(4).toString("hex")}`;
}
