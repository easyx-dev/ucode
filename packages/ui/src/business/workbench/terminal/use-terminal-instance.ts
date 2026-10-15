/**
 * xterm 实例的宿主：创建 / 销毁、跟随字号与配色、把实测尺寸报给服务端。
 *
 * 实例只建一次——重建会把屏幕内容一起丢掉，所以字号与主题走 `options` 更新，不重新 new。
 * 尺寸必须上报：PTY 的行列决定换行位置与全屏程序的布局，不报的话 `vim` 这类会画错。
 * 上报挂在 xterm 自己的 `onResize` 上：`fit()` 会改终端尺寸并触发它，所以容器变化、字号变化
 * 走的是同一个出口，不必在调用点各记一次。
 */

import { TERMINAL_COLS_MIN, TERMINAL_ROWS_MIN } from "@ucode/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { ITheme, Terminal } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClient } from "../../../provider";
import { useAppearance } from "../../../provider/appearance-provider";

/** 回滚行数：够翻一段命令输出，又不至于长跑任务的输出把内存吃满 */
const SCROLLBACK_LINES = 5000;

/** xterm 只吃具体的字体栈；`--font-terminal-base` 是「用户选的字体 + 中文回退的等宽栈」那一份 */
const terminalFontFamily = (): string => {
  if (typeof document === "undefined") return "monospace";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-terminal-base")
    .trim();
  return value || "monospace";
};

export function useTerminalInstance(input: {
  terminalId: string;
  fontSize: number;
  theme: ITheme | null;
}) {
  const { prefs } = useAppearance();
  const client = useClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  // 首帧的取值只用于建实例：建完就由下面的 effect 接管，不让实例随参数重建
  const initial = useRef(input);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const instance = new XTerm({
      fontSize: initial.current.fontSize,
      fontFamily: terminalFontFamily(),
      cursorBlink: true,
      scrollback: SCROLLBACK_LINES,
      theme: initial.current.theme ?? undefined,
      // unicode11 addon 走的是 proposed API（`terminal.unicode`）：它是官方 addon、
      // 与核心同版本发布，为了让中文扩展字符与 emoji 的列宽算得准，这里显式放行
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    // 默认是 Unicode 6 的宽度规则：中文扩展字符与 emoji 会算错列宽导致行内错位。
    // 这一步失败只影响宽度精度，绝不能让它把整个视图带崩（loadAddon 会同步抛）
    try {
      instance.loadAddon(new Unicode11Addon());
      instance.unicode.activeVersion = "11";
    } catch {
      // 降级：用默认宽度规则继续跑
    }
    instance.open(element);
    fitRef.current = fit;
    fit.fit();
    instance.focus();
    setTerminal(instance);

    return () => {
      fitRef.current = null;
      instance.dispose();
      setTerminal(null);
    };
  }, []);

  /** 量一次尺寸：容器变化与字号变化都要走（触发 `onResize`，上报在下个 effect 里） */
  const fit = useCallback(() => {
    fitRef.current?.fit();
  }, []);

  useEffect(() => {
    if (!terminal) return;
    terminal.options.fontSize = input.fontSize;
    terminal.options.theme = input.theme ?? undefined;
    // 字体在设置里换过要当场生效（已开的终端不会重建）；同值不重设，避免白白触发一次测量
    const family = terminalFontFamily();
    if (terminal.options.fontFamily !== family) terminal.options.fontFamily = family;
    // 字号与字体都会改变列数，改完重新量一次
    fit();
  }, [terminal, input.fontSize, input.theme, prefs.terminalFont, fit]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !terminal) return undefined;
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [terminal, fit]);

  // 尺寸的唯一上报出口。挂载时先主动对齐一次：初始 `fit()` 发生在监听挂上之前，
  // 而 xterm 只在值变化时触发 `onResize`——等它来报，服务端会一直在创建时的初值上。
  useEffect(() => {
    if (!terminal) return undefined;
    const report = (cols: number, rows: number): void => {
      // 容器还没布局时 fit 会算出 0 列，那不是合法尺寸，不发（服务端也会拒）
      if (cols < TERMINAL_COLS_MIN || rows < TERMINAL_ROWS_MIN) return;
      void client.apis.terminal
        .resize({ terminalId: input.terminalId, cols, rows })
        .catch(() => {});
    };
    report(terminal.cols, terminal.rows);
    const disposable = terminal.onResize(({ cols, rows }) => report(cols, rows));
    return () => disposable.dispose();
  }, [client, terminal, input.terminalId]);

  return { containerRef, terminal };
}
