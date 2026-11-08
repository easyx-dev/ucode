/**
 * 工作台面板：桌面端是活动栏 + 侧栏 + 编辑器区，窄屏是顶部视图条 + 单列（列表或编辑器）。
 *
 * 桌面端侧栏与编辑器并排、可拖宽（宽度按栏记忆），侧栏可以整列收起、收起后编辑器占满；
 * 窄屏抽屉只有一列宽，两者互斥——点开文件即切到编辑器，编辑器标签条左侧给返回箭头；
 * 那 40px 宽的竖排活动栏只在桌面端出现，窄屏换成列表页顶部那一条视图条（见 `workbench-view-bar`）。
 *
 * **设计视图没有侧栏**：稿子清单铺在主区，画布也铺在主区，两者靠同一个状态（`sidebarVisible`）
 * 一屏一屏地换——画布要占满，与清单并排会把稿子挤小。
 */
import { useEffect } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../base/resizable";
import { useIsDesktop } from "../../hooks/use-is-desktop";
import { usePanelLayout } from "../../hooks/use-panel-layout";
import { useWorkbench } from "../../provider/workbench";
import {
  HANDLE_IDS,
  PANEL_IDS,
  WORKBENCH_SIDE_PANEL,
  WORKBENCH_SIDE_PANELS,
} from "../../utils/panel-layout";
import { DesignFilesList } from "./design/design-files-list";
import { EditorArea } from "./file/editor-area";
import { useGitReview } from "./git/use-git-review";
import { WorkbenchActivityBar } from "./workbench-activity-bar";
import { WorkbenchSidebar } from "./workbench-sidebar";
import { WorkbenchViewBar } from "./workbench-view-bar";

export function WorkbenchPanel() {
  const workbench = useWorkbench();
  const isDesktop = useIsDesktop();
  const layout = usePanelLayout("workbench", WORKBENCH_SIDE_PANELS);
  const review = useGitReview(workbench?.cwd ?? null);
  const activeDocId = workbench?.activeDocId ?? null;
  const setSidebarVisible = workbench?.setSidebarVisible;
  /** 设计视图没有侧栏：`sidebarVisible` 在那里表示「看稿子清单」而不是「看侧栏」 */
  const isDesign = workbench?.view === "design";

  // 窄屏两栏互斥：打开任意文档即切到编辑器，返回箭头与活动栏图标切回侧栏。
  // 这里复用 sidebarVisible 而不是另立一份局部状态：活动栏按它切换，两份状态会看不见对方的效果。
  useEffect(() => {
    if (!isDesktop && activeDocId !== null) setSidebarVisible?.(false);
  }, [activeDocId, isDesktop, setSidebarVisible]);

  if (!workbench) return null;

  const activeDoc = workbench.docs.find((doc) => doc.id === workbench.activeDocId) ?? null;
  const activeFile = activeDoc?.kind === "file" ? activeDoc.path : null;
  const list = isDesign ? (
    <DesignFilesList />
  ) : (
    <WorkbenchSidebar review={review} activeFile={activeFile} />
  );
  const editor = (
    <EditorArea
      review={review}
      // 设计视图的清单与画布也靠这颗箭头来回：它没有侧栏，桌面端同样需要这个出口
      onBack={isDesktop && !isDesign ? undefined : () => workbench.setSidebarVisible(true)}
      onCollapse={isDesktop ? undefined : workbench.collapse}
    />
  );
  /**
   * 是否显示清单那一侧。设计视图额外兜一层「一个标签都没有」：关掉画布标签后仍落到清单上，
   * 而不是一个写着「在左侧项目树里选一个文件」的空编辑器（那里没有项目树）。
   */
  const showList = workbench.sidebarVisible || (isDesign && activeDocId === null);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 窄屏看文档时顶部是标签条（自带返回与收起），视图条只在列表页出现 */}
      {isDesktop || !showList ? null : <WorkbenchViewBar />}
      <div className="flex min-h-0 min-w-0 flex-1">
        {isDesktop ? <WorkbenchActivityBar /> : null}
        {!isDesktop || isDesign ? (
          showList ? (
            list
          ) : (
            editor
          )
        ) : showList ? (
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
              {list}
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
