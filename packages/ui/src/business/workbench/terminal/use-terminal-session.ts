/**
 * 一个终端的会话侧：把输出流的连接接到终端实例上，并记住结束态。
 *
 * 数据面交给 `@xterm/addon-attach`——socket 一建好就 `loadAddon`，双向数据都由它搬。
 * 这里只做四件它不管的事：每次（重）连把新 socket 接上、重连时先清屏（服务端会重放历史）、
 * 把终态翻译成界面用得上的状态、以及终态之后给一次手动重连的机会（流自己不会再试）。
 *
 * 两条来自 attach addon 实现的约束：它会把 socket 的**文本消息也写进屏幕**（所以服务端只发二进制），
 * 并且它在 socket 关闭时自我 dispose（所以每次连接都要重新 loadAddon）。
 */

import { createTerminalSocket, type TerminalExit, type TerminalSocket } from "@ucode/sdk";
import { AttachAddon } from "@xterm/addon-attach";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClient } from "../../../provider";

/** 流被判终态且不会再自愈的原因；进程退出不算「失联」，它由 `exitCode` 表达 */
export type TerminalLost = "gone" | "unauthorized";

export type TerminalSessionState = {
  /** 进程退出码；仍在跑、或结束原因不是「进程退出」时为 null */
  exitCode: number | null;
  /** 是否连上过（画面可用） */
  connected: boolean;
  /** 流已停止且不会自愈的原因；null 表示没发生 */
  lost: TerminalLost | null;
  /** 手动重连（重新取票建连）；流在终态后不会再自己试 */
  reconnect: () => void;
};

export function useTerminalSession(input: {
  terminalId: string;
  /** 挂载完成后的实例；为 null 时先不连 */
  terminal: Terminal | null;
}): TerminalSessionState {
  const client = useClient();
  const { terminalId, terminal } = input;
  const [state, setState] = useState<Omit<TerminalSessionState, "reconnect">>({
    exitCode: null,
    connected: false,
    lost: null,
  });
  const streamRef = useRef<TerminalSocket | null>(null);

  useEffect(() => {
    if (!terminal) return undefined;
    // 换终端时上一段的结束态不跟着走：它描述的是另一个进程
    setState({ exitCode: null, connected: false, lost: null });

    const stream = createTerminalSocket({ terminals: client.apis.terminal, terminalId });
    streamRef.current = stream;
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

    stream.onExit((exit: TerminalExit) => {
      setState((prev) => {
        if (exit.kind === "exit") {
          return prev.exitCode === exit.exitCode ? prev : { ...prev, exitCode: exit.exitCode };
        }
        return prev.lost === exit.kind ? prev : { ...prev, lost: exit.kind };
      });
    });

    stream.start();
    return () => {
      streamRef.current = null;
      attached?.dispose();
      stream.stop();
    };
  }, [client, terminal, terminalId]);

  const reconnect = useCallback(() => {
    const instance = terminal;
    const stream = streamRef.current;
    if (!instance || !stream) return;
    // 重连同样会重放整屏，先清屏；重连失败的终态会再写回 `lost`
    instance.reset();
    setState((prev) => ({ exitCode: null, connected: prev.connected, lost: null }));
    stream.start();
  }, [terminal]);

  return { ...state, reconnect };
}
