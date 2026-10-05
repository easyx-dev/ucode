/**
 * 客户端 i18n 接线：建实例，并在语言变化时持久化偏好、同步 `<html lang>` 与 dayjs。
 *
 * 文案目录与 house 约定都在 `@ucode/i18n`；这里只管语言持久化与 DOM 副作用。
 * 界面切换语言的入口是 `useLocale`（调用 i18n.changeLanguage），本模块监听其变化。
 * web 与桌面端各自调用一次，得到各自应用单例。
 */
import { localeStorageKey } from "@ucode/brand";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@ucode/contracts";
import { createI18n } from "@ucode/i18n";
import type { i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import { setDayjsLocale } from "./time";

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

export const createAppI18n = (): I18nInstance => {
  const i18n = createI18n({ lng: readStoredLocale(), plugins: [initReactI18next] });

  setDayjsLocale(isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE);

  i18n.on("languageChanged", (lng) => {
    if (!isLocale(lng)) return;
    try {
      localStorage.setItem(localeStorageKey, lng);
    } catch {
      // 存不下也不影响本次会话
    }
    document.documentElement.lang = lng;
    setDayjsLocale(lng);
  });

  return i18n;
};
