/** 子智能体设置：自定义角色（primary / subagent）的增删改；改动写入磁盘，新会话生效 */
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AssetSection } from "./asset-section";

export function SettingsAgents() {
  const { t } = useTranslation();
  return (
    <AssetSection
      kind="agent"
      icon={Bot}
      createLabel={t("新建角色")}
      emptyTitle={t("还没有自定义角色")}
      emptyDescription={t(
        "角色决定工具集与提示词。内置的 build / plan / ask 与 general / explore 始终可用，同名的自定义角色会覆盖它们。",
      )}
    />
  );
}
