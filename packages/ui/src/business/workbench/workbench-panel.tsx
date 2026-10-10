/**
 * 工作台面板：活动栏 + 侧栏 + 编辑器区。
 *
 * 桌面端侧栏与编辑器并排、可拖宽（宽度按栏记忆），侧栏可以整列收起、收起后编辑器占满；
 * 窄屏抽屉只有一列宽，两者互斥——点开文件即切到编辑器，编辑器标签条左侧给返回箭头。
 */
import { useEffect, useState } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../base/resizable";
import { useGitReview } from "../../hooks/use-git-review";
import { useIsDesktop } from "../../hooks/use-is-desktop";
import { usePanelLayout } from "../../hooks/use-panel-layout";
import {
  HANDLE_IDS,
  PANEL_IDS,
  WORKBENCH_SIDE_PANEL,
  WORKBENCH_SIDE_PANELS,
} from "../../lib/panel-layout";
import { useWorkbench } from "../../provider/workbench";
import { EditorArea } from "./editor-area";
import { WorkbenchActivityBar } from "./workbench-activity-bar";
import { WorkbenchSidebar } from "./workbench-sidebar";

export function WorkbenchPanel() {
  const workbench = useWorkbench();
  const isDesktop = useIsDesktop();
  const layout = usePanelLayout("workbench", WORKBENCH_SIDE_PANELS);
  const review = useGitReview(workbench?.cwd ?? null);
  // 窄屏互斥：打开任意文档即切到编辑器，返回箭头切回侧栏
  const [narrowEditing, setNarrowEditing] = useState(false);
  const activeDocId = workbench?.activeDocId ?? null;

  useEffect(() => {
    if (!isDesktop && activeDocId !== null) setNarrowEditing(true);
  }, [activeDocId, isDesktop]);

  if (!workbench) return null;

  const activeDoc = workbench.docs.find((doc) => doc.id === workbench.activeDocId) ?? null;
  const activeFile = activeDoc?.kind === "file" ? activeDoc.path : null;
  const sidebar = <WorkbenchSidebar review={review} activeFile={activeFile} />;
  const editor = (
    <EditorArea review={review} onBack={isDesktop ? undefined : () => setNarrowEditing(false)} />
  );
  const showSidebar = workbench.sidebarVisible;
  const narrowSidebar = narrowEditing ? editor : sidebar;

  return (
    <div className="flex h-full min-h-0 w-full">
      <WorkbenchActivityBar />
      <div className="flex min-w-0 flex-1">
        {!isDesktop ? (
          narrowSidebar
        ) : showSidebar ? (
          <ResizablePanelGroup
            id={`${PANEL_IDS.workbenchSidebar}-group`}
            orientation="horizontal"
            onLayoutChanged={layout.onLayoutChanged}
          >
            <ResizablePanel
              id={WORKBENCH_SIDE_PANEL.id}
              defaultSize={layout.defaultSizeOf(WORKBENCH_SIDE_PANEL)}
              minSize={WORKBENCH_SIDE_PANEL.min}
              maxSize={WORKBENCH_SIDE_PANEL.max}
              className="min-w-0 border-r border-border"
            >
              {sidebar}
            </ResizablePanel>
            {/* 命中区叠在侧栏右边缘上（自身宽度用负 margin 抵消）：不额外占宽，否则两侧之间会多出一条面板底色的缝 */}
            <ResizableHandle id={HANDLE_IDS.workbenchSidebar} className="-ml-1.5 w-1.5" />
            <ResizablePanel id={PANEL_IDS.workbenchEditor} className="min-w-0">
              {editor}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          editor
        )}
      </div>
    </div>
  );
}
