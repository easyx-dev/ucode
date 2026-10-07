/**
 * 面板标签条：树列开关 · 两个常驻标签 · 收起面板。
 *
 * 标签只有「改动」与「文件」，不可关闭；树列的内容随标签切换，
 * 因此开关放在最左，与两个标签同排。
 */
import { FolderTree, GitCompare, PanelLeft, PanelLeftClose, PanelRightClose } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../base/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../base/tooltip";
import { PANEL_TAB_ID, PANEL_TABPANEL_ID } from "../../lib/panel-layout";
import { useWorkbench, WORKBENCH_TABS, type WorkbenchTab } from "../../provider/workbench";

const TAB_ICON: Record<WorkbenchTab, typeof GitCompare> = {
  changes: GitCompare,
  files: FolderTree,
};

export function PanelTabs() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  if (!workbench) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            title={workbench.treeVisible ? t("隐藏树面板") : t("显示树面板")}
            onClick={workbench.toggleTree}
          >
            {workbench.treeVisible ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeft className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{workbench.treeVisible ? t("隐藏树面板") : t("显示树面板")}</TooltipContent>
      </Tooltip>

      <div role="tablist" aria-label={t("工作台标签")} className="flex items-center gap-0.5">
        {WORKBENCH_TABS.map((tab) => {
          const Icon = TAB_ICON[tab];
          const active = tab === workbench.tab;
          return (
            <button
              key={tab}
              type="button"
              id={PANEL_TAB_ID(tab)}
              role="tab"
              aria-selected={active}
              aria-controls={PANEL_TABPANEL_ID}
              className={
                active
                  ? "flex h-7 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-xs text-foreground"
                  : "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              }
              onClick={() => workbench.selectTab(tab)}
            >
              <Icon className="size-3.5" />
              {tab === "changes" ? t("改动") : t("文件")}
            </button>
          );
        })}
      </div>

      <div className="ml-auto pr-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              title={t("收起面板")}
              onClick={workbench.collapse}
            >
              <PanelRightClose className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("收起面板")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
