/**
 * 编辑器区的标签条：一份文档一个标签，可切换、可关闭。
 *
 * 每格拆成两个同级按钮（标题 + 关闭）——把按钮套进按钮会产生非法 HTML，读屏与键盘焦点也会错乱
 * （见 DESIGN.md「交互嵌套」）。窄屏下侧栏与编辑器互斥，最左给一个返回侧栏的箭头，最右给一个
 * 收起整个工作台的入口（窄屏没有活动栏，不给入口就只能靠对话区那颗被抽屉盖住的开关）。
 * 标签横向溢出时整条滚动，不换行。
 */

import { cn } from "cn";
import type { TFunction } from "i18next";
import {
  AppWindow,
  ChevronLeft,
  FileDiff,
  GitCommitHorizontal,
  Layers,
  PanelRightClose,
  SquareTerminal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../../base/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../base/context-menu";
import { useWorkbench } from "../../../provider/workbench";
import { fileIconOf } from "../../../utils/file-icons";
import { baseName } from "../../../utils/path";
import type { WorkbenchDoc } from "../workbench-docs";

/**
 * 标签标题：文件取文件名，diff 取文件名（提交里的 diff 带上短 hash），提交取 hash + 标题，
 * 终端按它在侧栏列表里的序号（服务端不下发名字），浏览器标签按它在浏览器标签里的序号。
 */
const titleOf = (
  doc: WorkbenchDoc,
  t: TFunction,
  /** 终端的创建序号（服务端下发，关掉别的终端也不会变）；不是终端文档时为 null */
  terminalSequence: number | null,
): string => {
  if (doc.kind === "file") return baseName(doc.path) || doc.path;
  if (doc.kind === "diff") {
    const name = baseName(doc.file) || doc.file;
    return doc.shortHash ? `${doc.shortHash} ${name}` : name;
  }
  if (doc.kind === "changes") return t("全部改动");
  if (doc.kind === "terminal") {
    return t("终端 {{index}}", { index: String(terminalSequence ?? 1) });
  }
  if (doc.kind === "browser") return t("浏览器 {{index}}", { index: doc.tabId.replace(/^t/, "") });
  return `${doc.commit.shortHash} ${doc.commit.subject}`.trim();
};

/** 标签图标：文件按类型，diff 用对比图标，提交用提交图标，终端与浏览器各用各的 */
const iconOf = (doc: WorkbenchDoc) => {
  if (doc.kind === "file") return fileIconOf(doc.path);
  if (doc.kind === "changes") return Layers;
  if (doc.kind === "terminal") return SquareTerminal;
  if (doc.kind === "browser") return AppWindow;
  return doc.kind === "diff" ? FileDiff : GitCommitHorizontal;
};

export function EditorTabs({
  onBack,
  onCollapse,
}: {
  onBack?: () => void;
  onCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  if (!workbench) return null;

  // 终端标题用服务端给的创建序号：按列表下标编号的话，关掉中间一个会让后面的整体前移
  const terminalSequences = new Map(
    workbench.terminals.map((terminal) => [terminal.id, terminal.sequence]),
  );

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border">
      {onBack ? (
        <IconButton
          className="shrink-0 text-foreground-subtle hover:text-foreground"
          label={t("返回文件列表")}
          size="icon-lg"
          onClick={onBack}
        >
          <ChevronLeft className="size-icon-base" />
        </IconButton>
      ) : null}

      <div
        role="tablist"
        aria-label={t("打开的标签")}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
      >
        {workbench.docs.map((doc) => {
          const Icon = iconOf(doc);
          const active = doc.id === workbench.activeDocId;
          const title = titleOf(
            doc,
            t,
            doc.kind === "terminal" ? (terminalSequences.get(doc.terminalId) ?? null) : null,
          );
          return (
            <ContextMenu key={doc.id}>
              <ContextMenuTrigger asChild>
                {/* `role="presentation"`：tablist 的直接子元素应是 tab，中间这层不该参与语义 */}
                <div
                  role="presentation"
                  className={cn(
                    "flex shrink-0 items-center gap-1 border-r border-border pr-1 pl-2.5 text-xs",
                    active
                      ? "bg-muted text-foreground"
                      : "text-foreground-subtle hover:bg-state-hover hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className="flex min-w-0 max-w-40 items-center gap-1.5 py-2"
                    title={title}
                    onClick={() => workbench.selectDoc(doc.id)}
                  >
                    <Icon className="size-icon-sm shrink-0" />
                    <span className="truncate">{title}</span>
                  </button>
                  <button
                    type="button"
                    className="flex size-icon-lg shrink-0 items-center justify-center rounded-sm text-foreground-subtlest hover:bg-background/60 hover:text-foreground"
                    title={t("关闭标签")}
                    onClick={() => workbench.closeDoc(doc.id)}
                  >
                    <X className="size-icon-xs" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => workbench.closeDoc(doc.id)}>
                  {t("关闭标签")}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={workbench.docs.length <= 1}
                  onSelect={() => workbench.closeOtherDocs(doc.id)}
                >
                  {t("关闭其他")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={workbench.closeAllDocs}>{t("关闭全部")}</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      {onCollapse ? (
        <IconButton
          className="shrink-0 border-l border-border text-foreground-subtle hover:text-foreground"
          label={t("收起面板")}
          size="icon-lg"
          onClick={onCollapse}
        >
          <PanelRightClose className="size-icon-base" />
        </IconButton>
      ) : null}
    </div>
  );
}
