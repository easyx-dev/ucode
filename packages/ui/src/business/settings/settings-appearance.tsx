/** 外观设置：主题三态与界面语言切换 */
import type { Locale } from "@ucode/contracts";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../hooks/use-locale";
import { SegmentedControl, type SegmentedOption } from "../segmented-control";
import { SettingsGroup, SettingsRow } from "./settings-row";

type ThemeValue = "light" | "dark" | "system";

export function SettingsAppearance() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const themeOptions = [
    { value: "light", label: t("浅色") },
    { value: "dark", label: t("深色") },
    { value: "system", label: t("跟随系统") },
  ] as const satisfies ReadonlyArray<SegmentedOption<ThemeValue>>;

  // 语言一律用母语名展示，不随界面语言翻译
  const localeOptions = [
    { value: "zh-CN", label: t("中文") },
    { value: "en", label: "English" },
  ] as const satisfies ReadonlyArray<SegmentedOption<Locale>>;

  const value: ThemeValue = theme === "light" || theme === "dark" ? theme : "system";

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("界面主题")}
        description={t("深色模式下的配色与浅色模式一一对应，切换后立即生效并记住选择。")}
        control={
          <SegmentedControl
            label={t("界面主题")}
            value={value}
            options={themeOptions}
            onChange={setTheme}
          />
        }
      />
      <SettingsRow
        title={t("语言")}
        description={t("界面语言，切换后立即生效并记住选择。")}
        control={
          <SegmentedControl
            label={t("语言")}
            value={locale}
            options={localeOptions}
            onChange={setLocale}
          />
        }
      />
    </SettingsGroup>
  );
}
