/**
 * 侧栏顶部功能菜单：新建任务 / 小助理 / 搜索 / 自动化 / 插件市场。
 *
 * 纯展示组件，点击回调由上层给出；自动化与插件市场当前是占位入口。
 */

import type { LucideIcon } from "lucide-react";
import { Blocks, CirclePlus, Search, Sparkles, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MOD_KEY_LABEL } from "../lib/platform";

type MenuItem = {
  id: string;
  icon: LucideIcon;
  label: string;
  /** 快捷键展示；无快捷键时省略 */
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
};

type SessionSidebarMenuProps = {
  canCreate: boolean;
  /** 新建任务（继承当前项目目录） */
  onCreate: () => void;
  /** 新建助理会话（不绑定目录） */
  onCreateAssistant: () => void;
  onOpenSearch: () => void;
  onOpenAutomation: () => void;
  onOpenMarketplace: () => void;
};

export function SessionSidebarMenu({
  canCreate,
  onCreate,
  onCreateAssistant,
  onOpenSearch,
  onOpenAutomation,
  onOpenMarketplace,
}: SessionSidebarMenuProps) {
  const { t } = useTranslation();

  const items: MenuItem[] = [
    {
      id: "new",
      icon: CirclePlus,
      label: t("新建任务"),
      shortcut: `${MOD_KEY_LABEL}N`,
      onClick: onCreate,
      disabled: !canCreate,
    },
    {
      id: "assistant",
      icon: Sparkles,
      label: t("小助理"),
      onClick: onCreateAssistant,
      disabled: !canCreate,
    },
    {
      id: "search",
      icon: Search,
      label: t("搜索"),
      shortcut: `${MOD_KEY_LABEL}K`,
      onClick: onOpenSearch,
    },
    {
      id: "automation",
      icon: Workflow,
      label: t("自动化"),
      onClick: onOpenAutomation,
    },
    {
      id: "marketplace",
      icon: Blocks,
      label: t("插件市场"),
      onClick: onOpenMarketplace,
    },
  ];

  return (
    <nav className="px-2 pb-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={item.disabled}
          onClick={item.onClick}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-sm outline-none transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          <item.icon className="size-icon-base shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.shortcut ? (
            <span className="shrink-0 text-xs text-foreground-subtle">{item.shortcut}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
