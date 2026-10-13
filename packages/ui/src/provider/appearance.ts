/**
 * 外观偏好：界面字号、界面密度、界面字体、代码字体与配色主题。
 *
 * 偏好属于设备本地（`localStorage`，键由品牌派生），web 与桌面端各存一份。
 * 应用只有一个出口 `applyAppearance`：把参数写到 `<html>` 的行内样式与 `data-theme`，
 * CSS 侧全部由这些参数派生——所以改字号只影响文字与图标，改密度只影响间距与控件尺寸。
 *
 * 首屏由 `index.html` 的内联脚本按同一个键预先应用（朴素写法，不能用这里的模块），
 * 否则会有一帧默认字号与默认主题。
 */
import { appearanceStorageKey } from "@ucode/brand";

import { uiFontFamilyOf, uiFontOf } from "./fonts";
import { type ColorThemeId, DEFAULT_COLOR_THEME_ID, isColorThemeId } from "./themes";

/** 界面密度：只缩放空间（间距、控件高度、栏宽），不动文字 */
export type DensityId = "compact" | "default" | "cozy";

export const DENSITY_OPTIONS: ReadonlyArray<{ id: DensityId; scale: number }> = [
  { id: "compact", scale: 0.9 },
  { id: "default", scale: 1 },
  { id: "cozy", scale: 1.1 },
];

/** 界面字号的允许区间：下界保证最小档仍 ≥ 12px，上界避免界面被撑散 */
export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 22;

/**
 * 偏好落盘的防抖时长。
 * 拖动字号滑块会在每帧产生一次变更，逐次落盘没有意义；统一延后落盘也避免了
 * 「依赖 pointerup / keyup 这类结束事件」的脆性（鼠标在窗口外松开就收不到）。
 */
export const PERSIST_DELAY_MS = 250;

export type AppearancePrefs = {
  /** 配色主题 */
  theme: ColorThemeId;
  /** 界面字号基准（px），五档字号由它派生 */
  fontSizeBase: number;
  /** 界面密度 */
  density: DensityId;
  /** 界面字体 id；等宽（代码 / diff / 终端）固定用系统栈，不进偏好 */
  uiFont: string;
};

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  theme: DEFAULT_COLOR_THEME_ID,
  fontSizeBase: FONT_SIZE_MIN,
  density: "default",
  uiFont: "geist",
};

const densityScaleOf = (density: DensityId): number =>
  DENSITY_OPTIONS.find((option) => option.id === density)?.scale ?? 1;

const isDensityId = (value: unknown): value is DensityId =>
  DENSITY_OPTIONS.some((option) => option.id === value);

const clampFontSize = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_APPEARANCE.fontSizeBase;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
};

/** 把任意外部输入（localStorage 里的旧值）收窄成合法偏好 */
export const normalizeAppearance = (value: unknown): AppearancePrefs => {
  const raw = (value ?? {}) as Partial<AppearancePrefs>;
  return {
    theme: isColorThemeId(raw.theme) ? raw.theme : DEFAULT_APPEARANCE.theme,
    fontSizeBase: clampFontSize(raw.fontSizeBase),
    density: isDensityId(raw.density) ? raw.density : DEFAULT_APPEARANCE.density,
    uiFont: uiFontOf(String(raw.uiFont ?? "")).id,
  };
};

export const readAppearance = (): AppearancePrefs => {
  try {
    const stored = localStorage.getItem(appearanceStorageKey);
    return stored ? normalizeAppearance(JSON.parse(stored)) : DEFAULT_APPEARANCE;
  } catch {
    // localStorage 不可用或值被写坏：按默认外观渲染，不阻塞启动
    return DEFAULT_APPEARANCE;
  }
};

export const writeAppearance = (prefs: AppearancePrefs): void => {
  try {
    localStorage.setItem(appearanceStorageKey, JSON.stringify(prefs));
  } catch {
    // 写不进去就只在本次会话生效
  }
};

/** 把偏好写到文档根节点：CSS 侧全部由这几个变量与属性派生 */
export const applyAppearance = (prefs: AppearancePrefs): void => {
  const root = document.documentElement;
  root.style.setProperty("--font-size-base", `${prefs.fontSizeBase}px`);
  root.style.setProperty("--density", String(densityScaleOf(prefs.density)));
  root.style.setProperty("--font-ui-base", uiFontFamilyOf(prefs.uiFont));
  if (prefs.theme === DEFAULT_COLOR_THEME_ID) root.removeAttribute("data-theme");
  else root.dataset.theme = prefs.theme;
};

/**
 * 按需加载选中的字体。放在应用之后单独调用：首屏内联脚本只设变量，
 * 未加载完先用回退字体渲染，加载完成后浏览器自己接上（`font-display: swap`）。
 */
export const loadAppearanceFonts = (prefs: AppearancePrefs): void => {
  void uiFontOf(prefs.uiFont)
    .load?.()
    .catch(() => {
      // 加载失败就停在回退字体上，不打断界面
    });
};
