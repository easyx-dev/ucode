/**
 * 终端配色：把设计 token 折成 xterm 的 `ITheme`。
 *
 * 不为 ANSI 调色板新增 token——16 个色各只用在这一处，立 token 只会让语义层多出一批没人复用的名字。
 * 基色取既有语义色（红 / 绿 / 黄 / 蓝 / 前景区分度），品红与青没有对得上的语义色，由红绿与蓝混合派生；
 * 亮色再朝前景偏一档。整组都从 token 算出来，深浅色与配色主题换代时自动跟上。
 */
import type { ITheme } from "@xterm/xterm";

/**
 * ANSI 基色：`var(--…)` 直取 token，其余是可求值的 `color-mix` 表达式
 * （求值方式见 `utils/color` 的 `resolveCssColor`）。
 */
const ANSI_BASE = {
  black: "var(--muted)",
  red: "var(--destructive)",
  green: "var(--success)",
  yellow: "var(--warning)",
  blue: "var(--info)",
  magenta: "color-mix(in oklab, var(--destructive) 45%, var(--info))",
  cyan: "color-mix(in oklab, var(--success) 45%, var(--info))",
  white: "var(--foreground)",
} as const;

/**
 * 亮色 = 基色朝前景偏 25%。这样两种主题下都朝着「更醒目」的方向走：
 * 浅色主题的前景是深色，亮色因此更深更沉；深色主题反过来更亮。
 */
const brightExpressionOf = (expression: string): string =>
  `color-mix(in oklab, ${expression} 75%, var(--foreground))`;

/** 终端界面自身的取色：底色跟随面板（终端是卡片的一部分），光标与选中走主色与状态层 */
const SURFACE_TOKENS = {
  background: "var(--surface)",
  foreground: "var(--foreground)",
  cursor: "var(--primary)",
  cursorAccent: "var(--background)",
  selectionBackground: "var(--state-selected)",
  selectionInactiveBackground: "var(--state-hover)",
} as const;

const capitalize = (name: string): string => `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;

/**
 * 组装主题。任一项取不到色就返回 null，由调用方退回 xterm 的内建配色——
 * 半套颜色混着用比默认配色更难看。
 *
 * `resolve` 由调用方给（浏览器里是 `utils/color` 的 `resolveCssColor`），
 * 因此这里的组装逻辑本身不依赖 DOM，可以单独测。
 */
export const buildTerminalTheme = (
  resolve: (expression: string) => string | null,
): ITheme | null => {
  const theme: Record<string, string> = {};

  for (const [name, expression] of Object.entries(ANSI_BASE)) {
    const base = resolve(expression);
    const bright = resolve(brightExpressionOf(expression));
    if (!base || !bright) return null;
    theme[name] = base;
    theme[`bright${capitalize(name)}`] = bright;
  }

  for (const [role, expression] of Object.entries(SURFACE_TOKENS)) {
    const color = resolve(expression);
    if (!color) return null;
    theme[role] = color;
  }

  return theme as ITheme;
};
