/**
 * 活动栏：面板最左那条窄图标列，切换侧栏看什么，以及收起整个面板。
 *
 * 点当前视图的图标即收起侧栏——这是 VSCode 的习惯，也让「收起」不必再占一个按钮位。
 * 两个图标都在位，不随目录是不是 git 仓库变化：位置固定比省一个图标重要。
 */

import { FolderTree, GitCompare, PanelRightClose, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../base/button";
import { useWorkbench, WORKBENCH_VIEWS, type WorkbenchView } from "../../provider/workbench";

const VIEW_ICON: Record<WorkbenchView, typeof FolderTree> = {
  files: FolderTree,
  changes: GitCompare,
  terminal: SquareTerminal,
};

const VIEW_LABEL: Record<WorkbenchView, string> = {
  files: "文件浏览", // i18n-ignore
  changes: "源代码管理", // i18n-ignore
  terminal: "终端", // i18n-ignore
};

export function WorkbenchActivityBar() {
  const { t } = useTranslation();
  /** 视图名按查表取文案：key 是动态值，这里按需收窄 t 的签名 */
  const translate = t as (key: string) => string;
  const workbench = useWorkbench();
  if (!workbench) return null;

  return (
    <div
      role="toolbar"
      aria-label={t("活动栏")}
      aria-orientation="vertical"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border py-2"
    >
      {WORKBENCH_VIEWS.map((view) => {
        const Icon = VIEW_ICON[view];
        const active = workbench.view === view && workbench.sidebarVisible;
        const label = translate(VIEW_LABEL[view]);
        return (
          <IconButton
            key={view}
            className={active ? undefined : "text-foreground-subtle hover:text-foreground"}
            label={label}
            pressed={active}
            size="icon"
            tooltipSide="right"
            onClick={() => workbench.selectView(view)}
          >
            <Icon className="size-icon-base" />
          </IconButton>
        );
      })}

      <IconButton
        className="mt-auto text-foreground-subtle hover:text-foreground"
        label={t("收起面板")}
        size="icon"
        tooltipSide="right"
        onClick={workbench.collapse}
      >
        <PanelRightClose className="size-icon-base" />
      </IconButton>
    </div>
  );
}
