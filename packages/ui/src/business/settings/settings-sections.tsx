/** 设置分区的展示元数据：导航标题与图标，导航栏与各页页头共用同一份 */
import {
  AppWindow,
  BookOpen,
  Bot,
  Brain,
  Globe,
  type LucideIcon,
  Network,
  Package,
  Palette,
  Plug,
  RadioTower,
  SlidersHorizontal,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingsSectionId } from "../../utils/settings-section";

export type SettingsSectionMeta = { label: string; icon: LucideIcon };

/** 标题是 i18n key（key 本身就是中文文案），故在此构造而不能放纯数据文件 */
export const useSettingsSectionMeta = (): Record<SettingsSectionId, SettingsSectionMeta> => {
  const { t } = useTranslation();
  return {
    appearance: { label: t("外观"), icon: Palette },
    models: { label: t("模型设置"), icon: Sparkles },
    defaults: { label: t("默认值"), icon: SlidersHorizontal },
    agents: { label: t("子智能体"), icon: Bot },
    skills: { label: t("技能"), icon: BookOpen },
    commands: { label: t("命令"), icon: Terminal },
    memory: { label: t("记忆"), icon: Brain },
    websearch: { label: t("联网搜索"), icon: Globe },
    browser: { label: t("浏览器"), icon: AppWindow },
    mcp: { label: t("MCP 服务器"), icon: Plug },
    plugins: { label: t("插件"), icon: Package },
    remote: { label: t("远程访问"), icon: Network },
    hub: { label: t("中继"), icon: RadioTower },
  };
};
