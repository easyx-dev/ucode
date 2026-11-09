/**
 * 活动栏：面板最左那条窄图标列，切换列表看什么，以及收起整个面板。
 *
 * 点当前视图的图标即收起侧栏——这是 VSCode 的习惯，也让「收起」不必再占一个按钮位。
 * 设计视图例外：它没有侧栏，点它一律回到稿子清单（见 `use-workbench-controller` 的 `selectView`）。
 * 两个图标都在位，不随目录是不是 git 仓库变化：位置固定比省一个图标重要。
 *
 * 插件贡献的视图排在最后：它们在插件装配好之后才出现，位置稳定比插在中间重要；
 * 视图键是 `<pluginId>:<viewId>`，插件只能打开自己的那一个。
 */

import { PanelRightClose } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../base/button";
import { usePluginUi } from "../../provider/plugin-host";
import { useWorkbench, WORKBENCH_VIEWS, type WorkbenchView } from "../../provider/workbench";
import { viewIconOf, viewLabelOf } from "./workbench-views";

export function WorkbenchActivityBar() {
  const { t } = useTranslation();
  /** 视图名按查表取文案：key 是动态值，这里按需收窄 t 的签名 */
  const translate = t as (key: string) => string;
  const workbench = useWorkbench();
  const pluginUi = usePluginUi();
  if (!workbench) return null;

  /** 内置视图 + 桌面端的浏览器面 + 设计 + 插件视图 */
  const entries: Array<{ key: WorkbenchView; label: string; icon: ReturnType<typeof viewIconOf> }> =
    [
      ...WORKBENCH_VIEWS.map((view) => ({
        key: view as WorkbenchView,
        label: translate(viewLabelOf(view)),
        icon: viewIconOf(view),
      })),
      ...(workbench.browser
        ? [
            {
              key: "browser" as WorkbenchView,
              label: translate(viewLabelOf("browser")),
              icon: viewIconOf("browser"),
            },
          ]
        : []),
      ...(pluginUi?.views ?? []).map((view) => ({
        key: `${view.pluginId}:${view.id}`,
        label: viewLabelOf(`${view.pluginId}:${view.id}`, view.label),
        icon: viewIconOf(`${view.pluginId}:${view.id}`, view.icon),
      })),
    ];

  return (
    <div
      role="toolbar"
      aria-label={t("活动栏")}
      aria-orientation="vertical"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border py-2"
    >
      {entries.map(({ key, label, icon: Icon }) => {
        const active = workbench.view === key && workbench.sidebarVisible;
        return (
          <IconButton
            key={key}
            className={active ? undefined : "text-foreground-subtle hover:text-foreground"}
            label={label}
            pressed={active}
            size="icon"
            tooltipSide="right"
            onClick={() => workbench.selectView(key)}
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
