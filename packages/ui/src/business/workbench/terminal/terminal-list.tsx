/**
 * 侧栏的终端视图：当前工作目录下的终端列表，顶部一行是「新建」与「刷新」。
 *
 * 列表里的条目就是编辑器区的标签——点开即挂上标签（进程一直在服务端跑着，重挂会重放最近的输出）。
 * 右侧的终止按钮与标签上的关闭是一回事，都结束进程：终端只有「跑着」与「被结束」两种归宿，
 * 没有「关掉界面但进程还在」的中间态。
 */
import { cn } from "cn";
import { Plus, RefreshCw, SquareTerminal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { useWorkbench } from "../../../provider/workbench";
import { terminalDocId } from "../workbench-docs";

export function TerminalList() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  if (!workbench) return null;

  const { terminals, cwd, activeDocId } = workbench;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-subtle">{t("终端")}</span>
        <IconButton
          disabled={!cwd}
          label={t("新建终端")}
          size="icon-sm"
          onClick={workbench.createTerminal}
        >
          <Plus className="size-icon-sm" />
        </IconButton>
        <IconButton label={t("刷新终端")} size="icon-sm" onClick={workbench.reloadTerminals}>
          <RefreshCw className="size-icon-xs" />
        </IconButton>
      </div>

      {workbench.terminalError === null ? null : (
        <p className="shrink-0 border-b border-border px-2 py-1.5 text-xs text-destructive">
          {workbench.terminalError}
        </p>
      )}

      {terminals.length === 0 ? (
        <Empty
          className="h-full"
          icon={<SquareTerminal className="size-7" />}
          title={t("还没有终端")}
          hint={t("点上面的加号新建一个，就在当前目录里")}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {terminals.map((terminal) => {
            // 与标签条同源（`terminalDocId`）：「正在看哪个终端」两个入口要一致
            const active = activeDocId === terminalDocId(terminal.id);
            return (
              <li
                key={terminal.id}
                className={cn(
                  "group mx-1 flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-xs",
                  active
                    ? "bg-state-selected text-foreground"
                    : "text-foreground-subtle hover:bg-state-hover hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                  onClick={() => workbench.openTerminal(terminal.id)}
                >
                  <SquareTerminal className="size-icon-sm shrink-0" />
                  <span className="truncate">
                    {t("终端 {{index}}", { index: String(terminal.sequence) })}
                  </span>
                  {terminal.running ? null : <span className="shrink-0">{t("已结束")}</span>}
                </button>
                <IconButton
                  label={t("结束终端")}
                  size="icon-xs"
                  onClick={() => workbench.closeTerminal(terminal.id)}
                >
                  <Trash2 className="size-icon-xs" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
