/**
 * 窄屏顶部视图条：<md 下取代竖排的活动栏，一行放视图切换与「收起面板」。
 *
 * 只在列表页出现——看文档时顶部是标签条（它自己带返回与收起），两页各有一条 36px 的头，不会叠成两条。
 * 视图按钮带文字；容器放不下时文字先截断（按钮最小一档图标宽），不折行、也不把右侧的收起按钮挤出去。
 * 插件视图与活动栏同一口径：内置在前，插件在后。
 */
import { cn } from "cn";
import { PanelRightClose } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, IconButton } from "../../base/button";
import { usePluginUi } from "../../provider/plugin-host";
import { useWorkbench, WORKBENCH_VIEWS, type WorkbenchView } from "../../provider/workbench";
import { viewIconOf, viewLabelOf } from "./workbench-views";

export function WorkbenchViewBar() {
  const { t } = useTranslation();
  /** 视图名按查表取文案：key 是动态值，这里按需收窄 t 的签名 */
  const translate = t as (key: string) => string;
  const workbench = useWorkbench();
  const pluginUi = usePluginUi();
  if (!workbench) return null;

  /** 浏览器入口的出现条件与活动栏同一口径；设计画布与插件视图始终在列 */
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
      aria-label={t("视图切换")}
      aria-orientation="horizontal"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2"
    >
      {entries.map(({ key, label, icon: Icon }) => {
        const active = workbench.view === key;
        return (
          <Button
            key={key}
            className={cn(
              "min-w-9 shrink",
              active ? "bg-state-selected text-foreground" : "text-foreground-subtle",
            )}
            variant="ghost"
            size="sm"
            aria-pressed={active}
            onClick={() => workbench.selectView(key)}
          >
            <Icon className="size-icon-sm shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
          </Button>
        );
      })}
      <IconButton
        className="ml-auto shrink-0 text-foreground-subtle hover:text-foreground"
        label={t("收起面板")}
        size="icon-sm"
        onClick={workbench.collapse}
      >
        <PanelRightClose className="size-icon-sm" />
      </IconButton>
    </div>
  );
}
