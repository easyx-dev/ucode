/**
 * web 侧的 i18n 接线：初始化实例、语言切换与首屏同步。
 *
 * 文案目录与 house 约定都在 `@ucode/i18n`；这里只管语言持久化与 DOM 副作用。
 */
import { localeStorageKey } from "@ucode/brand";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@ucode/contracts";
import { createI18n } from "@ucode/i18n";
import { setDayjsLocale } from "@ucode/ui/lib/time";
import { initReactI18next } from "react-i18next";

/** 读取持久化的语言偏好；缺失或非法时回落 DEFAULT_LOCALE */
export const readStoredLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(localeStorageKey);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    // 隐私模式下 localStorage 不可用，按默认语言渲染
    return DEFAULT_LOCALE;
  }
};

const i18n = createI18n({
  lng: readStoredLocale(),
  plugins: [initReactI18next],
});

setDayjsLocale(isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE);

/** 切换界面语言：更新 i18next、落盘偏好，并同步 `<html lang>` 与 dayjs */
export const applyLocale = (locale: Locale): void => {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  try {
    localStorage.setItem(localeStorageKey, locale);
  } catch {
    // 存不下也不影响本次会话
  }
  document.documentElement.lang = locale;
  setDayjsLocale(locale);
};

export default i18n;
