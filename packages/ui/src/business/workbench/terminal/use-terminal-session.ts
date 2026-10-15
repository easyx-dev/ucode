/**
 * 一个终端的会话侧：把输出流的连接接到终端实例上，并记住结束态。
 *
 * 数据面交给 `@xterm/addon-attach`——socket 一建好就 `loadAddon`，双向数据都由它搬。
 * 这里只做三件它不管的事：每次（重）连把新 socket 接上、重连时先清屏（服务端会重放历史）、
 * 把终态翻译成界面用得上的状态。
 *
 * 两条来自 attach addon 实现的约束：它会把 socket 的**文本消息也写进屏幕**（所以服务端只发二进制），
 * 并且它在 socket 关闭时自我 dispose（所以每次连接都要重新 loadAddon）。
 */

import { createTerminalSocket } from "@ucode/sdk";
import { AttachAddon } from "@xterm/addon-attach";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useState } from "react";

import { useClient } from "../../../provider";

export type TerminalSessionState = {
  /** 进程退出码；仍在跑、或结束原因不是「进程退出」时为 null */
  exitCode: number | null;
  /** 是否连上过（画面可用） */
  connected: boolean;
};

export function useTerminalSession(input: {
  terminalId: string;
  /** 挂载完成后的实例；为 null 时先不连 */
  terminal: Terminal | null;
}): TerminalSessionState {
  const client = useClient();
  const { terminalId, terminal } = input;
  const [state, setState] = useState<TerminalSessionState>({ exitCode: null, connected: false });

  useEffect(() => {
    if (!terminal) return undefined;
    const stream = createTerminalSocket({ terminals: client.apis.terminal, terminalId });
    let attached: AttachAddon | null = null;

    stream.onReconnect(() => {
      // 重放会把整屏重发一遍，不清屏就会叠在断线前那屏上
      terminal.reset();
    });

    stream.onOpen((socket) => {
      // 上一个 addon 在 socket 关闭时已自我 dispose，这里再收一次它挂在 terminal 上的壳
      attached?.dispose();
      const addon = new AttachAddon(socket as unknown as WebSocket);
      attached = addon;
      terminal.loadAddon(addon);
      setState((prev) => (prev.connected ? prev : { ...prev, connected: true }));
    });

    stream.onExit((exitCode) => {
      setState((prev) => (prev.exitCode === exitCode ? prev : { ...prev, exitCode }));
    });

    stream.start();
    return () => {
      attached?.dispose();
      stream.stop();
    };
  }, [client, terminal, terminalId]);

  return state;
}
