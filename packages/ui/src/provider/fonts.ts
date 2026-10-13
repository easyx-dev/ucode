/**
 * 界面字体选项：外观设置里「界面字体」的候选清单。
 *
 * 每款字体按需加载——`@fontsource-variable` 的 CSS 入口在选中时才动态引入，
 * 未加载完先用回退字体渲染（`font-display: swap`），不会为没选过的字体付出体积。
 *
 * 等宽（代码、diff、终端、路径）不走这里：它们只用系统等宽栈（`--font-mono-stack`），
 * 不打包 webfont——CJK 等宽字体单字重就是几 MB，收益配不上体积，见 DESIGN.md。
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
