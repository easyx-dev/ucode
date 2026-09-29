/** 外观设置：主题三态切换（浅色 / 深色 / 跟随系统） */
import { useTheme } from "next-themes";

import { SegmentedControl, type SegmentedOption } from "@/components/segmented-control";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-row";

const THEME_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const satisfies ReadonlyArray<SegmentedOption<string>>;

type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];

export function SettingsAppearance() {
  const { theme, setTheme } = useTheme();
  const value: ThemeValue =
    theme === "light" || theme === "dark" ? theme : ("system" satisfies ThemeValue);

  return (
    <SettingsGroup>
      <SettingsRow
        title="界面主题"
        description="深色模式下的配色与浅色模式一一对应，切换后立即生效并记住选择。"
        control={
          <SegmentedControl
            label="界面主题"
            value={value}
            options={THEME_OPTIONS}
            onChange={setTheme}
          />
        }
      />
    </SettingsGroup>
  );
}
