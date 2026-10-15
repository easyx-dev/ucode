/**
 * 预设：把侧栏、对话区、输入区与各对话框组合成一套完整工作区。
 *
 * 只接收受控的导航状态；产品行为（内置命令、计划批准、目标命令、会话动作）拆在同目录的几个 hook 里，
 * 应用层只需提供导航 props。需要更细的组合时自行用 `@ucode/ui/business/*` 拼装。
 */
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../base/resizable";
import { Sheet, SheetContent } from "../../base/sheet";
import { Toaster } from "../../base/sonner";
import { TooltipProvider } from "../../base/tooltip";
import { ChatPanel } from "../../business/chat/chat-panel";
import { compactionNoticeMessage } from "../../business/chat/message/compaction";
import {
  appendNodesToDoc,
  type ComposerNode,
  docToPayload,
  pageElementNode,
  textToDoc,
} from "../../business/composer/document/composer-document";
import { composerKeyOf, NEW_SESSION_KEY } from "../../business/composer/document/composer-draft";
import { textPayload } from "../../business/composer/document/composer-payload";
import { projectOf } from "../../business/composer/project/project";
import { useComposerDrafts } from "../../business/composer/use-composer-drafts";
import { DialogHost } from "../../business/dialog/dialog-host";
import { useSessionNotices } from "../../business/notify/use-session-notices";
import { SessionSidebar } from "../../business/session/session-sidebar";
import { SettingsPanel } from "../../business/settings/settings-panel";
import { CommandPalette } from "../../business/shell/command-palette";
import { ErrorToaster } from "../../business/shell/error-toaster";
import { UsagePanel } from "../../business/usage/usage-panel";
import { WorkbenchPanel } from "../../business/workbench/workbench-panel";
import { useChat } from "../../hooks/store/use-chat";
import { useConnectionResync } from "../../hooks/store/use-connection-resync";
import { useGoal } from "../../hooks/store/use-goal";
import { useInteractions } from "../../hooks/store/use-interactions";
import { useModels } from "../../hooks/store/use-models";
import { useProjects } from "../../hooks/store/use-projects";
import { useSessionUsage } from "../../hooks/store/use-session-usage";
import { useSessions } from "../../hooks/store/use-sessions";
import { useStatus } from "../../hooks/store/use-status";
import { useActiveSession } from "../../hooks/use-active-session";
import { usePanelLayout } from "../../hooks/use-panel-layout";
import { ComposerInsertProvider, type PickedPageContext } from "../../provider/composer-insert";
import type { WorkbenchBrowserSurface } from "../../provider/workbench";
import { WorkbenchProvider } from "../../provider/workbench";
import type { ChatItem, EditMessagePayload } from "../../types";
import {
  CHAT_MIN_WIDTH,
  HANDLE_IDS,
  PANEL_IDS,
  SIDEBAR_PANEL,
  WORKBENCH_PANEL,
  WORKSPACE_PANELS,
} from "../../utils/panel-layout";
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from "../../utils/settings-section";
import { useBuiltinCommands } from "./use-builtin-commands";
import { useGoalAndPlan } from "./use-goal-and-plan";
import { useSessionActions } from "./use-session-actions";
import { useWorkbenchController } from "./use-workbench-controller";
import { useWorkspaceChrome } from "./use-workspace-chrome";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";

export type WorkspaceLayoutProps = {
  /**
   * 无标题栏窗口顶部为自绘窗口控件让出的高度（px）：加在侧栏顶部（内容整体下移），
   * 空出的那条由布局与壳层各自的拖拽区接管。web 与带系统标题栏的窗口都不传（默认 0）。
   */
  titleBarInset?: number;
  /** 红绿灯的横向占位宽度（px，仅无标题栏窗口需要）：侧栏收起时对话区头部按它右移 */
  windowControlsWidth?: number;
  /**
   * 自绘窗口控件的宿主节点（仅无标题栏窗口传）：布局把它挂到覆盖它的那条拖拽区里——
   * 展开时是侧栏顶部那一条，收起时是对话区头部（`no-drag` 只对同一子树生效，挂错地方点不动）
   */
  windowControls?: ReactNode;
  /** 当前选中的会话；null 表示草稿态（新建） */
  sessionId: string | null;
  /**
   * 侧栏顶部是否显示品牌区（logo + 品牌名）。桌面端外壳传 false：窗口顶部已经是自绘控件与拖拽条，
   * 不需要再露一次品牌；web 端保持默认显示。
   */
  showBrand?: boolean;
  onSelectSession: (sessionId: string | null) => void;
  /** 设置界面当前的分区；null 表示未打开 */
  settingsSection: SettingsSectionId | null;
  onSettingsSectionChange: (section: SettingsSectionId | null) => void;
  usageOpen: boolean;
  onUsageOpenChange: (open: boolean) => void;
  /**
   * 宿主提供的浏览器面（**仅桌面端**传）：载体是 Electron 的 `<webview>`，所以只有自带窗体进程的一端
   * 才拿得出来。不传即工作台里没有浏览器视图、也没有浏览器标签（web 端）。
   */
  browser?: WorkbenchBrowserSurface | null;
};

export function WorkspaceLayout({
  titleBarInset = 0,
  windowControlsWidth = 0,
  windowControls,
  showBrand = true,
  sessionId: activeId,
  onSelectSession: setActiveId,
  settingsSection,
  onSettingsSectionChange: setSettingsSection,
  usageOpen,
  onUsageOpenChange: setUsageOpen,
  browser = null,
}: WorkspaceLayoutProps) {
  const { t } = useTranslation();
  const sessions = useSessions();
  const models = useModels();
  const projects = useProjects();
  const workspacesDir = useStatus()?.workspace ?? null;
  const composer = useComposerDrafts();
  // 会话归档 / id 失效时把选中项清回空态
  const activeSession = useActiveSession(activeId, () => setActiveId(null));
  const interactions = useInteractions(activeId);
  const goal = useGoal(activeId);
  const chat = useChat(activeId, { onSessionCreated: setActiveId });
  const sessionUsage = useSessionUsage(activeId);
  // 唯一通知触发点：web 与桌面端都在这里判定，点开通知即切到那条会话
  useSessionNotices({ onSelectSession: setActiveId });
  // 唯一通知触发点之外的连接校准：后台错过的收尾帧靠定时器看门狗收敛不了（见 useConnectionResync）
  const hasActiveRun =
    chat.streaming || chat.compacting || sessions.sessions.some((session) => session.running);
  useConnectionResync(hasActiveRun);

  const chrome = useWorkspaceChrome({ titleBarInset });
  const panels = usePanelLayout("workspace", WORKSPACE_PANELS);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /**
   * 当前工作目录：已有会话用它自己的工作目录；草稿态还没有会话，用草稿里选中的目录——
   * 「在某个项目里新建」时工作台与命令面板的文件检索都该落在那个项目上，而不是助理工作区。
   */
  const draftCwd = activeId ? null : (composer.drafts[NEW_SESSION_KEY]?.cwd ?? null);
  // 编辑器区的文档标签：工作目录变化即整体清空（见 use-workbench-docs）
  const workbenchCwd = activeSession?.cwd ?? draftCwd ?? workspacesDir;
  // 工作台显隐按项目记忆：助理工作区与草稿态没有项目，回落全局键
  const workbenchProjectId = projectOf(projects.projects, workbenchCwd)?.id ?? null;
  /**
   * 把「从页面上选中的元素」落进当前输入框：宿主给摘要文本，这里追加到当前草稿的文档尾部并落盘
   * （与「编辑重发」「/命令填充」同一条路：改草稿的 doc，输入框自己会同步）。
   */
  const insertPickedContext = useCallback(
    (picked: PickedPageContext) => {
      const key = composerKeyOf(activeId);
      const current = composer.drafts[key];
      const base =
        (current?.doc as ComposerNode | undefined) ??
        (current?.text ? textToDoc(current.text) : undefined);
      // 芯片是行内节点，得自己裹一个段落：直接落进 doc 顶层会被 schema 拒掉
      const doc = appendNodesToDoc(base, [
        {
          type: "paragraph",
          content: [
            pageElementNode({
              label: picked.label,
              summary: picked.text,
              ...(picked.meta ?? {}),
            }),
          ],
        },
      ]);
      composer.update(key, { doc, text: docToPayload(doc).text });
    },
    [activeId, composer],
  );

  const workbench = useWorkbenchController({
    cwd: workbenchCwd,
    projectId: workbenchProjectId,
    isDesktop: chrome.isDesktop,
    setSheetOpen: chrome.setWorkbenchSheetOpen,
    browser,
  });

  // 压缩的结果提示（内容太少 / 已压缩过 / 自动压缩失败）：不是错误，只弹一条轻提示——
  // 它们都没有对应的消息区痕迹，不提示的话用户只会看到「什么都没发生」；弹过即 ack，避免重渲染时重复弹
  const compactionNotice = chat.compactionNotice;
  const ackCompactionNotice = chat.ackCompactionNotice;
  useEffect(() => {
    if (!compactionNotice) return;
    toast.info(compactionNoticeMessage(compactionNotice, t));
    ackCompactionNotice();
  }, [compactionNotice, ackCompactionNotice, t]);

  const actions = useSessionActions({
    activeId,
    session: activeSession,
    workspacesDir,
    sessions,
    projects,
    composer,
    setActiveId,
  });
  const plan = useGoalAndPlan({
    activeId,
    session: activeSession,
    chat,
    goal,
    sessions,
    setActiveId,
  });

  /** 各入口统一落到模型设置页：未配置模型时用户要找的就是它 */
  const openSettings = (): void => setSettingsSection(DEFAULT_SETTINGS_SECTION);

  const runBuiltin = useBuiltinCommands({
    activeId,
    session: activeSession,
    chat,
    composer,
    sessions,
    setActiveId,
    startNewSession: actions.startNewSession,
    requestRename: actions.requestRename,
    forkCurrent: actions.forkCurrent,
    openSettings,
  });

  useWorkspaceShortcuts({
    onTogglePalette: () => setPaletteOpen((prev) => !prev),
    onToggleSidebar: chrome.toggleSidebar,
    onOpenWorkspace: actions.pickDirectory,
    onNewSession: actions.startNewSession,
  });

  const configured = models.data?.configured ?? false;
  const interaction = interactions.pending[0] ?? null;

  const editMessage = (item: ChatItem, payload: EditMessagePayload): Promise<boolean> =>
    chat.edit(item.id, payload);

  // 分叉来源会话名：从当前列表取，取不到（已归档 / 未加载）则退化为 id
  const forkSourceId = activeSession?.forkedFromId ?? null;
  const forkSourceName = forkSourceId
    ? (sessions.sessions.find((item) => item.id === forkSourceId)?.name ?? null)
    : null;

  // 本端正在生成时无需等服务端事件，列表项就能显示运行态
  const sessionsView = useMemo(
    () =>
      sessions.sessions.map((session) =>
        session.id === activeId && chat.streaming ? { ...session, running: true } : session,
      ),
    [activeId, chat.streaming, sessions.sessions],
  );

  const sidebarProps = {
    sessions: sessionsView,
    showBrand,
    projects: projects.projects,
    workspacesDir,
    activeId,
    loading: sessions.loading,
    configured,
    onSelect: setActiveId,
    onCreate: actions.startNewSession,
    onCreateAssistant: actions.startAssistantSession,
    onCreateInDirectory: actions.startInDirectory,
    onRenameProject: actions.requestRenameProject,
    onReorderProjects: (paths: string[]) => {
      void projects.reorder(paths);
    },
    onArchive: (id: string) => {
      void sessions.archive(id);
      composer.clear(composerKeyOf(id));
    },
    onTogglePin: actions.togglePin,
    onOpenSearch: () => setPaletteOpen(true),
    onOpenWorkspace: actions.pickDirectory,
    onOpenAutomation: () => toast.info(t("自动化功能即将推出")),
    onOpenMarketplace: () => toast.info(t("插件市场即将推出")),
    onOpenSettings: openSettings,
  };

  return (
    <TooltipProvider>
      <ComposerInsertProvider insert={insertPickedContext}>
        <WorkbenchProvider value={workbench.api}>
          {/* 四周留白见 DESIGN.md「间距与尺寸」：外壳容器统一留，内容卡不再自己留 margin */}
          {/* 外壳是最底层，用玻璃面 + 模糊：窗口透明或加了背景图之后它会透出后面那层 */}
          <div className="flex h-dvh w-full overflow-hidden bg-glass text-foreground backdrop-blur-sm md:p-shell-inset">
            {/* 桌面端三栏分栏；窄屏只有对话区，侧栏与工作台走下方抽屉 */}
            <ResizablePanelGroup
              id={`${PANEL_IDS.sidebar}-group`}
              orientation="horizontal"
              onLayoutChanged={panels.onLayoutChanged}
            >
              {chrome.isDesktop && !chrome.sidebarCollapsed ? (
                <>
                  <ResizablePanel
                    id={SIDEBAR_PANEL.id}
                    defaultSize={panels.defaultSizeOf(SIDEBAR_PANEL)}
                    minSize={SIDEBAR_PANEL.min}
                    maxSize={SIDEBAR_PANEL.max}
                    className="min-w-0"
                  >
                    <div
                      className="relative flex h-full w-full"
                      style={{ paddingTop: titleBarInset }}
                    >
                      <SessionSidebar {...sidebarProps} />
                      {/*
                      侧栏顶部那条既是拖拽区也是窗口控件的宿主：控件挂在它里面（而不是另起一个覆盖层），
                      `-webkit-app-region` 的 `no-drag` 只对同一子树生效，挂成兄弟子树会被这条拖拽区吃掉点击。
                      不加 `aria-hidden`：里面的窗口控件带 aria-label，是这条里唯一可读的内容
                    */}
                      {titleBarInset > 0 ? (
                        <div
                          className="window-drag absolute inset-x-0 top-0"
                          style={{ height: titleBarInset }}
                        >
                          {windowControls}
                        </div>
                      ) : null}
                    </div>
                  </ResizablePanel>
                  <ResizableHandle id={HANDLE_IDS.sidebar} className="-ml-3" />
                </>
              ) : null}

              <ResizablePanel id={PANEL_IDS.chat} minSize={CHAT_MIN_WIDTH} className="min-w-0">
                <div className="flex h-full w-full">
                  <ChatPanel
                    session={activeSession}
                    models={models.data}
                    workspacesDir={workspacesDir}
                    chat={chat}
                    composer={composer}
                    configured={configured}
                    onReloadModels={() => void models.refresh()}
                    onSelectModel={actions.selectModel}
                    onSelectThinkingLevel={actions.selectThinkingLevel}
                    onSelectMode={actions.selectMode}
                    onSelectPermissionMode={actions.selectPermissionMode}
                    onOpenSettings={openSettings}
                    onOpenSession={setActiveId}
                    onToggleSidebar={() => {
                      // 桌面端切换收起，窄屏开关抽屉（与按钮上显示的图标保持一致）
                      if (chrome.isDesktop) chrome.toggleSidebar();
                      else chrome.setSidebarOpen((prev) => !prev);
                    }}
                    sidebarCollapsed={chrome.headerOwnsLeftEdge}
                    titleBarInset={titleBarInset}
                    /*
                    判据是「无标题栏」而不是桌面断点：非 macOS 传进来的 titleBarInset 为 0，
                    这三颗点一次都不该渲染（那是系统控件的地盘）；窄屏侧栏不常驻，让位区也跟着不在了
                  */
                    windowControlsWidth={
                      titleBarInset > 0 && chrome.headerOwnsLeftEdge ? windowControlsWidth : 0
                    }
                    windowControls={
                      titleBarInset > 0 && chrome.headerOwnsLeftEdge ? windowControls : undefined
                    }
                    onToggleWorkbench={workbench.toggle}
                    workbenchOpen={chrome.isDesktop ? workbench.open : chrome.workbenchSheetOpen}
                    onRenameSession={
                      activeSession ? () => actions.requestRename(activeSession) : undefined
                    }
                    onLoadTranscript={activeId ? actions.loadTranscript : undefined}
                    onFork={actions.forkFrom}
                    onEdit={editMessage}
                    forkedFromName={forkSourceName}
                    goal={goal.goal}
                    onGoalCommand={plan.runGoalCommand}
                    onGoalBudget={plan.setGoalBudget}
                    usage={sessionUsage.usage}
                    context={sessionUsage.context}
                    onOpenUsage={() => setUsageOpen(true)}
                    onBackToParent={() => {
                      const parentId = activeSession?.parentSessionId;
                      if (parentId) setActiveId(parentId);
                    }}
                    planReady={plan.planReady}
                    onApprovePlan={plan.approvePlan}
                    onIgnorePlan={plan.ignorePlan}
                    onFeedbackPlan={(text) => void chat.send(textPayload(text))}
                    interaction={interaction}
                    onRespondInteraction={(input) => void interactions.respond(input)}
                    onBuiltin={runBuiltin}
                  />
                </div>
              </ResizablePanel>

              {chrome.isDesktop && workbench.open ? (
                <>
                  {/* 两栏之间只留 `--shell-inset`（与外壳四周同宽）：命中区仍占 8px，靠 `-ml-1` 叠进对话区右边缘 */}
                  <ResizableHandle id={HANDLE_IDS.workbench} className="-ml-1 w-2" />
                  <ResizablePanel
                    id={WORKBENCH_PANEL.id}
                    defaultSize={panels.defaultSizeOf(workbench.panelSpec)}
                    minSize={WORKBENCH_PANEL.min}
                    className="min-w-0"
                  >
                    <div className="flex h-full w-full">
                      <div className="flex h-full w-full overflow-hidden bg-surface md:rounded-md md:border md:border-border">
                        <WorkbenchPanel />
                      </div>
                    </div>
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>

            <Sheet open={chrome.sidebarOpen} onOpenChange={chrome.setSidebarOpen}>
              <SheetContent title={t("会话列表")} className="md:hidden">
                <SessionSidebar
                  {...sidebarProps}
                  onSelect={(id) => {
                    setActiveId(id);
                    chrome.setSidebarOpen(false);
                  }}
                  onCreate={() => {
                    actions.startNewSession();
                    chrome.setSidebarOpen(false);
                  }}
                  onCreateAssistant={() => {
                    actions.startAssistantSession();
                    chrome.setSidebarOpen(false);
                  }}
                  onCreateInDirectory={(path) => {
                    actions.startInDirectory(path);
                    chrome.setSidebarOpen(false);
                  }}
                  onOpenSettings={() => {
                    chrome.setSidebarOpen(false);
                    openSettings();
                  }}
                />
              </SheetContent>
            </Sheet>

            <Sheet open={chrome.workbenchSheetOpen} onOpenChange={chrome.setWorkbenchSheetOpen}>
              <SheetContent side="right" title={t("工作台")} className="md:hidden">
                <WorkbenchPanel />
              </SheetContent>
            </Sheet>

            <UsagePanel
              open={usageOpen}
              onOpenChange={setUsageOpen}
              onOpenSession={setActiveId}
              context={sessionUsage.context}
              titleBarInset={titleBarInset}
            />

            {settingsSection ? (
              <SettingsPanel
                section={settingsSection}
                onSectionChange={setSettingsSection}
                onClose={() => setSettingsSection(null)}
                titleBarInset={titleBarInset}
                onSaved={() => {
                  void models.reload();
                }}
              />
            ) : null}

            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              sessions={sessionsView}
              fileRoot={workbenchCwd}
              hasSession={activeId !== null}
              onSelectSession={setActiveId}
              onRunBuiltin={runBuiltin}
              onNewTask={actions.startNewSession}
              onNewAssistant={actions.startAssistantSession}
              onOpenWorkspace={actions.pickDirectory}
              onOpenSettings={openSettings}
              onToggleSidebar={chrome.toggleSidebar}
              onToggleWorkbench={workbench.toggle}
              onOpenFile={workbench.openFile}
            />

            <Toaster position="top-center" />
            <DialogHost />
            <ErrorToaster />
          </div>
        </WorkbenchProvider>
      </ComposerInsertProvider>
    </TooltipProvider>
  );
}
