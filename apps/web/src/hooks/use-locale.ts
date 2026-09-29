/** 当前界面语言与切换入口：读 i18next 的语言状态，切换走 applyLocale */
import { DEFAULT_LOCALE, isLocale, type Locale } from "@ucode/contracts";
import { useTranslation } from "react-i18next";

import { applyLocale } from "@/lib/i18n";

export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  // useTranslation 订阅了 languageChanged，语言一变本组件即重渲染，语言值随之更新
  const { i18n } = useTranslation();
  const locale = isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
  return { locale, setLocale: applyLocale };
}
