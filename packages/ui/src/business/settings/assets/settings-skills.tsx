/** 技能设置：`skills/<name>/SKILL.md` 的增删改；模型按 description 自动选用，也可 /skill:名字 显式调用 */
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AssetSection } from "./asset-section";

export function SettingsSkills() {
  const { t } = useTranslation();
  return (
    <AssetSection
      kind="skill"
      icon={BookOpen}
      createLabel={t("新建技能")}
      emptyTitle={t("还没有自定义技能")}
      emptyDescription={t(
        "技能是写给模型的说明书：把步骤、约定或命令放进 SKILL.md，模型按说明里的描述判断何时使用。",
      )}
    />
  );
}
