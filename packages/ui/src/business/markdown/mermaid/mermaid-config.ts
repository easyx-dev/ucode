/**
 * Mermaid 主题：把语义 token 翻成 mermaid 的 `themeVariables`。
 *
 * 用 `base` 主题并逐项给颜色，是因为 mermaid 自带的几套主题与本仓库配色无关；每一项都取自 token，
 * 深浅色由 token 自己切换。token 一个都读不到（无 DOM、变量缺失）时退回 mermaid 内建的深 / 浅主题，
 * 不把半套颜色混着用。
 */
import type { MermaidConfig } from "@streamdown/mermaid";
import { cssColorToRgb } from "./mermaid-color";

/** 图表需要的颜色角色 → 语义 token；token 定义在 `theme.css` */
const COLOR_TOKENS = {
  /** 画布与节点底：与图块容器同色，图看起来是卡片的一部分 */
  surface: "--card",
  /** 节点填充 */
  node: "--muted",
  /** 提示块与次级元素。取实色而非 `--state-hover`：后者是带透明度的叠加层，采色后交给 mermaid 会变成半透明底 */
  accent: "--secondary",
  /** 正文与标签 */
  text: "--foreground",
  /** 连线、信号线 */
  line: "--foreground-subtle",
  /** 描边与分隔 */
  border: "--border",
} as const;

type DiagramColors = Record<keyof typeof COLOR_TOKENS, string>;

/** mermaid 把「文字 / 线 / 填充」拆得很细，这里按角色映射，不逐项照抄它的默认值 */
const diagramThemeVariables = (
  colors: DiagramColors,
  fontFamily: string,
): Record<string, string> => ({
  background: colors.surface,
  mainBkg: colors.surface,
  primaryColor: colors.node,
  primaryTextColor: colors.text,
  primaryBorderColor: colors.border,
  secondaryColor: colors.accent,
  secondaryTextColor: colors.text,
  secondaryBorderColor: colors.border,
  tertiaryColor: colors.surface,
  tertiaryTextColor: colors.text,
  tertiaryBorderColor: colors.border,
  textColor: colors.text,
  lineColor: colors.line,
  nodeBorder: colors.border,
  clusterBkg: colors.surface,
  clusterBorder: colors.border,
  edgeLabelBackground: colors.surface,
  actorBkg: colors.node,
  actorBorder: colors.border,
  actorTextColor: colors.text,
  signalColor: colors.line,
  signalTextColor: colors.text,
  noteBkgColor: colors.accent,
  noteTextColor: colors.text,
  fontFamily,
});

const readColors = (style: CSSStyleDeclaration): DiagramColors | null => {
  const entries = Object.entries(COLOR_TOKENS) as [keyof DiagramColors, string][];
  const resolved = entries.map(([role, token]) => {
    const value = style.getPropertyValue(token).trim();
    return [role, value ? cssColorToRgb(value) : null] as const;
  });
  // 只要有一项读不出来就整套退回内建主题：半套颜色混用比默认配色更难看
  if (resolved.some(([, color]) => color === null)) return null;
  return Object.fromEntries(resolved as [keyof DiagramColors, string][]) as DiagramColors;
};

/** 安全边界与渲染时机：图源来自模型输出，保持 mermaid 的 strict，并自己接管失败展示 */
const BASE_CONFIG: MermaidConfig = {
  securityLevel: "strict",
  startOnLoad: false,
  suppressErrorRendering: true,
};

export const createMermaidConfig = (isDark: boolean): MermaidConfig => {
  const fallbackTheme = isDark ? "dark" : "default";
  if (typeof document === "undefined") return { ...BASE_CONFIG, theme: fallbackTheme };
  const style = getComputedStyle(document.documentElement);
  const colors = readColors(style);
  if (!colors) return { ...BASE_CONFIG, theme: fallbackTheme };
  const fontFamily = style.getPropertyValue("--font-sans").trim() || "sans-serif";
  return {
    ...BASE_CONFIG,
    theme: "base",
    themeVariables: diagramThemeVariables(colors, fontFamily),
  };
};
