/**
 * 侧栏的浏览器视图：当前打开的浏览器标签列表，顶部一行是「新建标签」。
 *
 * 列表里的条目就是编辑器区的标签（与标签条同源，都按 `browserDocId` 认）——点开即切到那一个。
 * 一个标签是一个 `<webview>`，关标签即销毁它；浏览器数据（cookie / localStorage）不归标签管，
 * 它们在同一份 partition 里，关掉标签不会掉登录态。
 */

import { IconButton } from "@ucode/ui/base/button";
import { Empty } from "@ucode/ui/base/empty";
import { useWorkbench } from "@ucode/ui/provider";
import { AppWindow, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

export function BrowserSidebar() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  if (!workbench) return null;

  const tabs = workbench.docs.filter((doc) => doc.kind === "browser");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-subtle">
          {t("浏览器")}
        </span>
        <IconButton label={t("新标签")} size="icon-sm" onClick={workbench.openBrowserTab}>
          <Plus className="size-icon-sm" />
        </IconButton>
      </div>

      {tabs.length === 0 ? (
        <Empty
          className="h-full"
          icon={<AppWindow className="size-7" />}
          title={t("还没有浏览器标签")}
          hint={t("点上面的加号新开一个；agent 也能驱动它，你在这里直接看着它操作。")}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {tabs.map((doc) => {
            // 与标签条同源：「正在看哪个标签」两个入口要一致
            const active = workbench.activeDocId === doc.id;
            return (
              <li
                key={doc.id}
                className={`mx-1 flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-xs ${
                  active
                    ? "bg-state-selected text-foreground"
                    : "text-foreground-subtle hover:bg-state-hover hover:text-foreground"
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                  onClick={() => workbench.selectDoc(doc.id)}
                >
                  <AppWindow className="size-icon-sm shrink-0" />
                  <span className="truncate">
                    {t("浏览器 {{index}}", { index: doc.tabId.replace(/^t/, "") })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
