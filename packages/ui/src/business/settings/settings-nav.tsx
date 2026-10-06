/**
 * 设置界面的分类导航：桌面端是左侧固定栏，窄屏收成顶部横向 tab 条。
 *
 * 导航底部的动作区（取消 / 保存并生效）是草稿模式下唯一始终可见的提交入口。
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
} from "../../lib/settings-section";
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
        "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
        selected
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
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
        selected ? "bg-sidebar-accent font-medium" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SaveActions({
  saving,
  loading,
  onClose,
  onSave,
}: Omit<SettingsNavProps, "section" | "onSectionChange">) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-3">
      <Button className="w-full" onClick={onSave} disabled={saving || loading}>
        {saving ? <Spinner className="size-4" /> : null}
        {t("保存并生效")}
      </Button>
      <Button className="w-full" variant="ghost" onClick={onClose} disabled={saving}>
        {t("取消")}
      </Button>
    </div>
  );
}

function DesktopNav({
  section,
  onSectionChange,
  onClose,
  saving,
  loading,
  onSave,
}: SettingsNavProps) {
  const { t } = useTranslation();
  const meta = useSettingsSectionMeta();
  const groupLabels: Record<SettingsGroupId, string> = {
    basics: t("基础设置"),
    agent: t("Agent 能力"),
    service: t("服务"),
  };

  return (
    <nav className="hidden w-60 min-w-0 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-14 shrink-0 items-center px-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="size-4" />
          {t("返回工作区")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-2">
        {SETTINGS_GROUP_IDS.map((group) => (
          <div key={group} className="space-y-1">
            <h3 className="px-2 text-xs font-medium text-muted-foreground">{groupLabels[group]}</h3>
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

      <SaveActions saving={saving} loading={loading} onClose={onClose} onSave={onSave} />
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
    <div className="flex min-w-0 shrink-0 flex-col gap-2 border-b border-border bg-sidebar px-2 py-2 md:hidden">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("返回工作区")} onClick={onClose}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t("取消")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || loading}>
            {saving ? <Spinner className="size-3.5" /> : null}
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
