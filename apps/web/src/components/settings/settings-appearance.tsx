/** 外观设置：主题三态与界面语言切换 */
import type { Locale } from "@ucode/contracts";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

import { SegmentedControl, type SegmentedOption } from "@/components/segmented-control";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-row";
import { useLocale } from "@/hooks/use-locale";

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
        description={t("界面主题.说明")}
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
        description={t("语言.说明")}
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
