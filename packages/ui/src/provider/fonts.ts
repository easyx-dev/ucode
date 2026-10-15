/**
 * 界面字体选项：外观设置里「界面字体」的候选清单。
 *
 * 每款字体按需加载——`@fontsource-variable` 的 CSS 入口在选中时才动态引入，
 * 未加载完先用回退字体渲染（`font-display: swap`），不会为没选过的字体付出体积。
 *
 * 等宽（代码、diff、路径）不走这里：它们只用系统等宽栈（`--font-mono-stack`），
 * 不打包 webfont——CJK 等宽字体单字重就是几 MB，收益配不上体积，见 DESIGN.md。
 * 终端另有一份清单（`TERMINAL_FONTS`）：它要的是「本机装了才生效」的族名，与打包无关。
 *
 * 显示名是专有名词，保持原文；「系统默认」这类中文文案由设置组件 `t()` 提供，
 * 所以这里不出现中文。
 */
export type FontOption = {
  /** 偏好里记录的值 */
  id: string;
  /** 展示名（专有名词，不翻译） */
  name: string;
  /** CSS `font-family` 首选名；系统字体给通用族名，保证栈头部始终有效 */
  family: string;
  /** 按需加载入口：首次选中该字体时调用 */
  load?: () => Promise<unknown>;
};

export const UI_FONTS: readonly FontOption[] = [
  {
    id: "geist",
    name: "Geist",
    family: "Geist Variable",
    load: () => import("@fontsource-variable/geist"),
  },
  {
    id: "inter",
    name: "Inter",
    family: "Inter Variable",
    load: () => import("@fontsource-variable/inter"),
  },
  { id: "system", name: "System", family: "system-ui" },
];

export const DEFAULT_UI_FONT_ID = "geist";

/** 未知 id 一律回落到默认字体，不把偏好里的陈旧值带到界面上 */
export const uiFontOf = (id: string): FontOption =>
  UI_FONTS.find((option) => option.id === id) ??
  (UI_FONTS.find((option) => option.id === DEFAULT_UI_FONT_ID) as FontOption);

export const uiFontFamilyOf = (id: string): string => uiFontOf(id).family;

/**
 * 终端字体选项：外观设置里「终端字体」的候选清单。
 *
 * 比界面字体多一层现实约束：候选族名多来自 Nerd Font 系列，用来让提示符里的图标
 * （私有区码位）有字形——系统等宽栈里没有这些字形，终端只会画成方框。
 *
 * 这些都是「装了才生效」的档：浏览器不提供「本机装了什么字体」这个信息，所以既不探测也不猜，
 * 选中后只把族名接在系统等宽栈**之前**，没装的人完全落回等宽栈，与默认档没有任何差别。
 */
export type TerminalFontOption = {
  /** 偏好里记录的值 */
  id: string;
  /** 展示名（专有名词，不翻译） */
  name: string;
  /**
   * 接在系统等宽栈之前的族名（已带引号，多个用 ", " 连接）；空串表示直接用等宽栈（默认档）。
   *
   * 同一款 Nerd Font 在不同来源下家族名不一样（brew 装的 Meslo 叫 `MesloLGS Nerd Font`，
   * powerlevel10k 文档让手装的叫 `MesloLGS NF`，JetBrainsMono 还有 `…NL` 变体），
   * 所以一个档位并列写出该字体常见的几个名字，命中哪个用哪个。
   */
  family: string;
};

/** 默认档：与代码、diff、路径共用同一份系统等宽栈 */
export const DEFAULT_TERMINAL_FONT_ID = "mono";

export const TERMINAL_FONTS: readonly TerminalFontOption[] = [
  { id: DEFAULT_TERMINAL_FONT_ID, name: "Mono", family: "" },
  {
    id: "meslo-nerd",
    name: "MesloLGS Nerd Font",
    family: '"MesloLGS NF", "MesloLGS Nerd Font", "MesloLGM Nerd Font"',
  },
  {
    id: "jetbrains-nerd",
    name: "JetBrainsMono Nerd Font",
    family: '"JetBrainsMono Nerd Font", "JetBrainsMonoNL Nerd Font"',
  },
  { id: "hack-nerd", name: "Hack Nerd Font", family: '"Hack Nerd Font", "Hack Nerd Font Mono"' },
  { id: "fira-nerd", name: "FiraCode Nerd Font", family: '"FiraCode Nerd Font"' },
  {
    id: "symbols-nerd",
    name: "Symbols Nerd Font",
    family: '"Symbols Nerd Font", "Symbols Nerd Font Mono"',
  },
];

/** 偏好里的合法取值，供校验与测试自检 */
export const TERMINAL_FONT_IDS: readonly string[] = TERMINAL_FONTS.map((option) => option.id);

/** 未知 id 一律回落到默认档，不把偏好里的陈旧值带到界面上 */
export const terminalFontOf = (id: string): TerminalFontOption =>
  TERMINAL_FONTS.find((option) => option.id === id) ??
  (TERMINAL_FONTS.find((option) => option.id === DEFAULT_TERMINAL_FONT_ID) as TerminalFontOption);

/** 要接在等宽栈之前的那段族名；默认档是空串，调用方据此决定覆盖还是清掉行内值 */
export const terminalFontFamilyOf = (id: string): string => terminalFontOf(id).family;
