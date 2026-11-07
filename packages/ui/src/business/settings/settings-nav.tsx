/**
 * 设置界面的分类导航：桌面端是左侧固定栏，窄屏收成顶部横向 tab 条。
 *
 * 桌面端的保存入口在页头（见 SettingsPageHeader），这里的保存动作只服务窄屏顶部条；
 * 导航底部是用户身份区，不放动作。
 */
import { cn } from "cn";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Spinner } from "../../base/spinner";
import {
  SETTINGS_GROUP_IDS,
  SETTINGS_GROUP_SECTIONS,
  SETTINGS_SECTION_IDS,
  type SettingsGroupId,
  type SettingsSectionId,
} from "../../utils/settings-section";
import { LocalUserRow } from "../session/local-user-row";
import { useSettingsSectionMeta } from "./settings-sections";

type SettingsNavProps = {
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  /** 关闭设置：取消未保存的草稿并回工作区 */
  onClose: () => void;
  saving: boolean;
  /** 草稿尚未加载完时禁止保存 */
  loading: boolean;
  onSave: () => void;
};

function NavItem({
  label,
  icon: Icon,
  selected,
  onSelect,
}: {
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
        selected
          ? "bg-state-selected font-medium text-foreground"
          : "text-foreground hover:bg-state-hover",
      )}
    >
      <Icon className="size-icon-base shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

function TabItem({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "flex h-8 shrink-0 items-center rounded-lg px-2.5 text-sm whitespace-nowrap transition-colors",
        selected ? "bg-state-selected font-medium" : "text-foreground-subtle",
      )}
    >
      {label}
    </button>
  );
}

function DesktopNav({ section, onSectionChange, onClose }: SettingsNavProps) {
  const { t } = useTranslation();
  const meta = useSettingsSectionMeta();
  const groupLabels: Record<SettingsGroupId, string> = {
    basics: t("基础设置"),
    agent: t("Agent 能力"),
  };

  return (
    <nav className="hidden w-60 min-w-0 shrink-0 flex-col border-r border-border bg-background md:flex">
      <div className="shrink-0 px-2 pt-3 pb-1">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="size-icon-base" />
          {t("返回工作区")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-3">
        {SETTINGS_GROUP_IDS.map((group) => (
          <div key={group} className="space-y-1">
            <h3 className="px-2 pb-1 text-xs font-medium text-foreground-subtle">
              {groupLabels[group]}
            </h3>
            {SETTINGS_GROUP_SECTIONS[group].map((id) => (
              <NavItem
                key={id}
                label={meta[id].label}
                icon={meta[id].icon}
                selected={id === section}
                onSelect={() => onSectionChange(id)}
              />
            ))}
          </div>
        ))}
      </div>

      <LocalUserRow className="shrink-0 border-t border-border" />
    </nav>
  );
}

function MobileNav({
  section,
  onSectionChange,
  onClose,
  saving,
  loading,
  onSave,
}: SettingsNavProps) {
  const { t } = useTranslation();
  const meta = useSettingsSectionMeta();

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-2 border-b border-border bg-background px-2 py-2 md:hidden">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("返回工作区")} onClick={onClose}>
          <ArrowLeft className="size-icon-base" />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t("取消")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || loading}>
            {saving ? <Spinner className="size-icon-sm" /> : null}
            {t("保存")}
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 gap-1 overflow-x-auto">
        {SETTINGS_SECTION_IDS.map((id) => (
          <TabItem
            key={id}
            label={meta[id].label}
            selected={id === section}
            onSelect={() => onSectionChange(id)}
          />
        ))}
      </div>
    </div>
  );
}

export function SettingsNav(props: SettingsNavProps) {
  return (
    <>
      <DesktopNav {...props} />
      <MobileNav {...props} />
    </>
  );
}
