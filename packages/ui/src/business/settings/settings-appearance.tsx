/** 外观设置：主题三态、界面语言与消息区显示偏好 */
import type { Locale } from "@ucode/contracts";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../hooks/use-locale";
import { useShowThinking } from "../../hooks/use-show-thinking";
import { SegmentedControl, type SegmentedOption } from "../segmented-control";
import { SettingsGroup, SettingsRow } from "./settings-row";

type ThemeValue = "light" | "dark" | "system";
type ThinkingValue = "visible" | "hidden";

export function SettingsAppearance() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const themeOptions = [
    { value: "light", label: t("浅色") },
    { value: "dark", label: t("深色") },
    { value: "system", label: t("跟随系统") },
  ] as const satisfies ReadonlyArray<SegmentedOption<ThemeValue>>;

  const { showThinking, setShowThinking } = useShowThinking();
  const thinkingOptions = [
    { value: "visible", label: t("显示") },
    { value: "hidden", label: t("不显示") },
  ] as const satisfies ReadonlyArray<SegmentedOption<ThinkingValue>>;

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
        title={t("思考过程")}
        description={t("在消息区展示模型的思考过程；隐藏后只保留回答与工具调用。")}
        control={
          <SegmentedControl
            label={t("思考过程")}
            value={showThinking ? "visible" : "hidden"}
            options={thinkingOptions}
            onChange={(next) => setShowThinking(next === "visible")}
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
