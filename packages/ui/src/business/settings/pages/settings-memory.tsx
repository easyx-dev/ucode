/** 记忆设置：全局开关 + 项目级记忆的浏览入口（按项目列出已有记忆，展开读正文） */
import { useTranslation } from "react-i18next";

import { Switch } from "../../../base/switch";
import { SettingsMemoryProjects } from "../memory/settings-memory-projects";
import { SettingsGroup, SettingsRow } from "../settings-row";

type SettingsMemoryProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function SettingsMemory({ enabled, onChange }: SettingsMemoryProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingsRow
          title={t("项目记忆")}
          description={t(
            "开启后，每轮对话结束会在后台回顾并保存项目级长期记忆，同一项目的后续会话自动带上；记忆只保存在本机，并按项目目录隔离。这里是默认值，单个项目可以在侧栏的项目行上单独开关。",
          )}
          control={
            <Switch checked={enabled} onCheckedChange={onChange} aria-label={t("项目记忆")} />
          }
        />
      </SettingsGroup>

      <SettingsMemoryProjects />
    </div>
  );
}
