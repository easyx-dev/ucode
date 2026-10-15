/**
 * 终端配色跟随外观：深浅色、配色主题、字号密度都写在根节点的属性与行内样式上
 * （与 `use-token-number` 同一套观察目标），变了就重新采样一套 `ITheme`。
 *
 * 采样要读 DOM，所以首次渲染可能拿不到（预渲染、测试），此时返回 null，调用方交给 xterm 的内建配色。
 */
import type { ITheme } from "@xterm/xterm";
import { useEffect, useState } from "react";

import { resolveCssColor } from "../../../utils/color";
import { buildTerminalTheme } from "./terminal-theme";

export function useTerminalTheme(): ITheme | null {
  const [theme, setTheme] = useState<ITheme | null>(() => buildTerminalTheme(resolveCssColor));

  useEffect(() => {
    const sync = (): void => {
      setTheme(buildTerminalTheme(resolveCssColor));
    };
    // 挂载时先对齐一次：外观参数可能在本次渲染之前就被写进根节点
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
