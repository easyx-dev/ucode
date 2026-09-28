import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAgentStore } from "../context.ts";
import { CloseIcon, TerminalIcon } from "./icons.tsx";
import { IconButton } from "./primitives.tsx";

/**
 * 终端面板（xterm.js，ZCode 的终端标签页同款交互）。
 *
 * 字节流走协议 C 的 PTY 通道：`sdk.openTerminal` → channel.data（base64）↔ xterm；
 * 容器尺寸变化时自动 resize（FitAddon + channel.resize）。
 * 组件卸载时关闭通道（服务层会随之杀掉 shell，不留孤儿进程）。
 */
export function TerminalPanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}): ReactNode {
  const sdk = useAgentStore((store) => store.sdk);
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    // 宿主此刻必须已在布局中（面板展开后再挂载本组件），否则 xterm 量不到尺寸
    if (element.clientHeight < 40) return;
    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: {
        background: "#0d0d0d",
        foreground: "#ededed",
        cursor: "#0ea5e9",
        selectionBackground: "#264f78",
      },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);

    let disposed = false;
    let handle: Awaited<ReturnType<typeof sdk.openTerminal>> | undefined;
    let observer: ResizeObserver | undefined;

    void (async () => {
      try {
        const cols = Math.max(20, Math.floor(element.clientWidth / 8));
        const rows = Math.max(6, Math.floor(element.clientHeight / 17));
        handle = await sdk.openTerminal(
          sessionId,
          {
            onData: (base64) => {
              terminal.write(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
            },
            onClose: (reason) => {
              terminal.writeln(`\r\n\x1b[2m${reason ?? "通道已关闭"}\x1b[0m`);
            },
          },
          { cols, rows },
        );
        if (disposed) {
          handle.close();
          return;
        }
        setReady(true);
        fit.fit();
        terminal.onData((data) => {
          handle?.write(btoa(unescape(encodeURIComponent(data))));
        });
        observer = new ResizeObserver(() => fit.fit());
        observer.observe(element);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      handle?.close();
      terminal.dispose();
    };
  }, [sdk, sessionId]);

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-code)]">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 text-[11px] text-[var(--color-content-muted)]">
        <TerminalIcon className="size-3.5" />
        <span>终端 · {sessionId.slice(0, 12)} 的工作区</span>
        <span className="ml-auto" />
        <IconButton icon={<CloseIcon />} label="关闭终端" onClick={onClose} />
      </div>
      {error !== null ? (
        <p className="p-3 text-xs text-[var(--color-danger)]">终端打开失败：{error}</p>
      ) : (
        <div className="relative min-h-0 flex-1">
          {/* xterm 必须在**可见**的容器里初始化（隐藏时量不到字符尺寸，画布会是空的） */}
          <div ref={host} className="absolute inset-0 p-1" />
          {!ready && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-content-muted)]">
              正在打开终端…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
