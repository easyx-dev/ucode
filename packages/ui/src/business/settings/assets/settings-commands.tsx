/** 命令设置：`prompts/<name>.md` 的增删改；在输入框用 /名字 调用，正文替换命令本身 */
import { Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AssetSection } from "./asset-section";

export function SettingsCommands() {
  const { t } = useTranslation();
  return (
    <AssetSection
      kind="command"
      icon={Terminal}
      createLabel={t("新建命令")}
      emptyTitle={t("还没有自定义命令")}
      emptyDescription={t(
        "命令是常用的提示词模板：写好正文后，在输入框用 /名字 调用，正文会替换掉命令本身。",
      )}
    />
  );
}
