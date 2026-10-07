/**
 * 工作台面板：标签条 + 「树列 | 内容」两栏。
 *
 * 两栏都随激活标签切换内容：改动标签的树列是变更树（按目录折层）、内容是所选文件的
 * 改动前后 diff（或所选提交的详情）；文件标签的树列是项目目录树、内容是文件预览。
 * 树列可以整列关掉，此时内容占满；两栏之间是分栏（宽度可拖且按栏记忆），
 * 分界靠树列自己的右边框。
 */
import { FileQuestionMark, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../base/resizable";
import { useGitReview } from "../../hooks/use-git-review";
import { usePanelLayout } from "../../hooks/use-panel-layout";
import {
  FILE_PANELS,
  FILE_TREE_PANEL,
  HANDLE_IDS,
  PANEL_IDS,
  PANEL_TAB_ID,
  PANEL_TABPANEL_ID,
} from "../../lib/panel-layout";
import { useWorkbench } from "../../provider/workbench";
import { FileContent } from "./file-content";
import { FileTree } from "./file-tree";
import { PanelEmpty } from "./panel-empty";
import { PanelTabs } from "./panel-tabs";
import { ReviewContent } from "./review-content";
import { ReviewTree } from "./review-tree";

/** 树列外壳：自带右边框作为与内容区的分界 */
function TreeColumn({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full flex-col border-r border-border">{children}</div>;
}

export function WorkbenchPanel() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const layout = usePanelLayout("file-panels", FILE_PANELS);
  const cwd = workbench?.cwd ?? null;
  // 改动标签的两半共享同一份状态：在面板这一层持有，交给左右两列
  const review = useGitReview(cwd);

  if (!workbench) return null;

  const isChanges = workbench.tab === "changes";
  const showTree = workbench.treeVisible && cwd !== null;

  const treeColumn = isChanges ? (
    cwd ? (
      <ReviewTree review={review} cwd={cwd} onSelectCommit={review.openCommit} />
    ) : (
      <PanelEmpty icon={<FileQuestionMark className="size-7" />} title={t("当前没有工作目录")} />
    )
  ) : cwd ? (
    <FileTree root={cwd} activeFile={workbench.activeFile} />
  ) : (
    <PanelEmpty icon={<FileQuestionMark className="size-7" />} title={t("当前没有工作目录")} />
  );

  const content = isChanges ? (
    cwd ? (
      <ReviewContent review={review} cwd={cwd} />
    ) : (
      <PanelEmpty icon={<FileQuestionMark className="size-7" />} title={t("当前没有工作目录")} />
    )
  ) : workbench.activeFile ? (
    <FileContent key={workbench.activeFile} path={workbench.activeFile} />
  ) : (
    <PanelEmpty
      icon={<FolderOpen className="size-7" />}
      title={t("打开文件")}
      hint={t("在左侧项目树里选一个文件")}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <PanelTabs />
      <div
        id={PANEL_TABPANEL_ID}
        role="tabpanel"
        aria-labelledby={PANEL_TAB_ID(workbench.tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {showTree ? (
          <ResizablePanelGroup
            id={`${PANEL_IDS.tree}-group`}
            orientation="horizontal"
            onLayoutChanged={layout.onLayoutChanged}
          >
            <ResizablePanel
              id={FILE_TREE_PANEL.id}
              defaultSize={layout.defaultSizeOf(FILE_TREE_PANEL)}
              minSize={FILE_TREE_PANEL.min}
              maxSize={FILE_TREE_PANEL.max}
              className="min-w-0"
            >
              <TreeColumn>{treeColumn}</TreeColumn>
            </ResizablePanel>
            <ResizableHandle id={HANDLE_IDS.tree} className="w-1.5" />
            <ResizablePanel id={PANEL_IDS.preview} className="min-w-0">
              {content}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
