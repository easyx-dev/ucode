/**
 * 配色主题：只换一组颜色，不动字体、字号与圆角。
 *
 * 每个主题在 `styles/themes/<id>.css` 里覆盖主题层（`--theme-*`），深浅各一块；
 * 这里的清单驱动设置面板，`scripts/verify` 会校验两份清单一一对应（缺一个即报错）。
 * 主题显示名由设置组件 `t()` 提供，所以这里不出现中文。
 */
export const COLOR_THEME_IDS = ["default", "zinc"] as const;

export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

export const DEFAULT_COLOR_THEME_ID: ColorThemeId = "default";

export const isColorThemeId = (value: unknown): value is ColorThemeId =>
  typeof value === "string" && (COLOR_THEME_IDS as readonly string[]).includes(value);
