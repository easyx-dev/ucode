/**
 * 预设：把侧栏、对话区、输入区与各对话框组合成一套完整工作区。
 *
 * 只接收受控的导航状态；产品行为（内置命令、计划批准、目标命令、会话动作）都在这里，
 * 应用层只需提供导航 props。需要更细的组合时自行用 `@ucode/ui/business/*` 拼装。
 */
import { brand } from "@ucode/brand";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../base/resizable";
import { Sheet, SheetContent } from "../base/sheet";
import { Toaster } from "../base/sonner";
import { TooltipProvider } from "../base/tooltip";
import { ChatPanel } from "../business/chat-panel";
import { CommandPalette } from "../business/command-palette";
import { DirectoryPickerDialog } from "../business/directory-picker-dialog";
import { ErrorToaster } from "../business/error-toaster";
import { PermissionDialog } from "../business/permission-dialog";
import { QuestionDialog } from "../business/question-dialog";
import { RenameSessionDialog } from "../business/rename-session-dialog";
import { SessionSidebar } from "../business/session-sidebar";
import { SettingsPanel } from "../business/settings/settings-panel";
import { UsagePanel } from "../business/usage/usage-panel";
import { WelcomePanel } from "../business/welcome-panel";
import { WorkbenchPanel } from "../business/workbench/workbench-panel";
import { useActiveSession } from "../hooks/use-active-session";
import { useChat } from "../hooks/use-chat";
import { useComposerDrafts } from "../hooks/use-composer-drafts";
import { useGoal } from "../hooks/use-goal";
import { useInteractions } from "../hooks/use-interactions";
import { useIsDesktop } from "../hooks/use-is-desktop";
import { useModels } from "../hooks/use-models";
import { usePanelLayout } from "../hooks/use-panel-layout";
import { useSessionNotices } from "../hooks/use-session-notices";
import { useSessionUsage } from "../hooks/use-session-usage";
import { useSessions } from "../hooks/use-sessions";
import { useStatus } from "../hooks/use-status";
import { BUILTIN_COMMANDS, type BuiltinCommandId } from "../lib/builtin-commands";
import { composerKeyOf, NEW_SESSION_KEY } from "../lib/composer-draft";
import { textPayload } from "../lib/composer-payload";
import type { GoalCommand } from "../lib/goal-command";
import {
  HANDLE_IDS,
  PANEL_IDS,
  SIDEBAR_PANEL,
  WORKBENCH_PANEL,
  WORKSPACE_PANELS,
} from "../lib/panel-layout";
import { lastTurnPresentedPlan } from "../lib/plan";
import { sessionTitle } from "../lib/session";
import { isWorkspaceSession } from "../lib/session-groups";
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from "../lib/settings-section";
import type {
  ChatItem,
  PermissionMode,
  SessionCreateRequest,
  SessionSummary,
  ThinkingLevel,
} from "../lib/types";
import { WorkbenchProvider, type WorkbenchTab } from "../provider/workbench";

export type WorkspaceLayoutProps = {
  /** 当前选中的会话；null 表示草稿态（新建） */
  sessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  /** 设置界面当前的分区；null 表示未打开 */
  settingsSection: SettingsSectionId | null;
  onSettingsSectionChange: (section: SettingsSectionId | null) => void;
  usageOpen: boolean;
  onUsageOpenChange: (open: boolean) => void;
};

/** 侧栏收起状态的持久化键 */
const SIDEBAR_COLLAPSED_KEY = `${brand.slug}-sidebar-collapsed`;

/** 读出上次的侧栏收起状态；读不到时默认展开 */
const readSidebarCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

export function WorkspaceLayout({
  sessionId: activeId,
  onSelectSession: setActiveId,
  settingsSection,
  onSettingsSectionChange: setSettingsSection,
  usageOpen,
  onUsageOpenChange: setUsageOpen,
}: WorkspaceLayoutProps) {
  const { t } = useTranslation();
  const sessions = useSessions();
  const models = useModels();
  const workspacesDir = useStatus()?.workspace ?? null;
  const composer = useComposerDrafts();
  // 会话归档 / id 失效时把选中项清回空态
  const activeSession = useActiveSession(activeId, () => setActiveId(null));
  const interactions = useInteractions(activeId);
  const goal = useGoal(activeId);
  // 唯一通知触发点：web 与桌面端都在这里判定，点开通知即切到那条会话
  useSessionNotices({ onSelectSession: setActiveId });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  // 工作台：默认收起（用 open 表示）；标签、树列可见性与预览目标一并受控
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("changes");
  const [treeVisible, setTreeVisible] = useState(true);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [workbenchSheetOpen, setWorkbenchSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<{ sessionId: string; name: string } | null>(null);

  const isDesktop = useIsDesktop();
  // 外层三栏一组：侧栏与工作台各自记住宽度，对话区占剩余
  const panels = usePanelLayout("workspace", WORKSPACE_PANELS);

  const configured = models.data?.configured ?? false;
  const chat = useChat(activeId, { onSessionCreated: setActiveId });
  const sessionUsage = useSessionUsage(activeId);
  const interaction = interactions.pending[0] ?? null;

  /** 各入口统一落到模型设置页：未配置模型时用户要找的就是它 */
  const openSettings = (): void => setSettingsSection(DEFAULT_SETTINGS_SECTION);

  // 拉宽到桌面断点时自动收起两个抽屉：抽屉内容有 `md:hidden` 会消失，遮罩没有，
  // 不收起来就会留下一层盖住全屏、且把 body 置为 pointer-events: none 的遮罩
  useEffect(() => {
    if (!isDesktop) return;
    setSidebarOpen(false);
    setWorkbenchSheetOpen(false);
  }, [isDesktop]);

  /** 收起 / 展开侧栏并落盘；移动端抽屉由 sidebarOpen 单独管 */
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // 写不进去（隐私模式）不影响使用
      }
      return next;
    });
  }, []);

  /** 展开工作台；窄屏下同时唤出抽屉 */
  const showWorkbench = useCallback(() => {
    setWorkbenchOpen(true);
    if (!isDesktop) setWorkbenchSheetOpen(true);
  }, [isDesktop]);

  /** 打开某个文件的预览：展开面板、切到「文件」标签 */
  const openPreview = useCallback(
    (path: string) => {
      setActiveFile(path);
      setWorkbenchTab("files");
      showWorkbench();
    },
    [showWorkbench],
  );

  /** 工作台的动作面：面板状态在预设里受控，业务组件只经这里拿动作 */
  const workbenchApi = useMemo(
    () => ({
      tab: workbenchTab,
      selectTab: setWorkbenchTab,
      treeVisible,
      toggleTree: () => setTreeVisible((prev) => !prev),
      activeFile,
      openPreview,
      collapse: () => setWorkbenchOpen(false),
      cwd: activeSession?.cwd ?? workspacesDir,
    }),
    [activeFile, activeSession?.cwd, openPreview, treeVisible, workbenchTab, workspacesDir],
  );

  // 打开会话即标记已读：内容新于上次已读、且不在生成中时才提交，避免自我循环
  useEffect(() => {
    if (!activeSession || activeSession.running) return;
    if (activeSession.lastReadAt && activeSession.updatedAt <= activeSession.lastReadAt) return;
    void sessions.markRead(activeSession.id);
  }, [activeSession, sessions.markRead]);

  // plan 模式本轮以 present_plan 收尾：用决策表单替掉输入区
  const planReady =
    activeSession?.mode === "plan" && !chat.streaming && lastTurnPresentedPlan(chat.items);

  const approvePlan = (): void => {
    if (!activeId) return;
    void (async () => {
      await sessions.setMode(activeId, "build");
      await chat.send(textPayload(t("计划已批准，请开始执行。")));
    })();
  };

  // 忽略本次计划：服务端往会话文件追加标记条目，表单靠 transcript_reset 收起
  const ignorePlan = (): void => {
    void chat.ignorePlan();
  };

  // 空态（还没有会话）时，选择器改的是草稿里的初始设置，建会话时一并生效；
  // 已有会话走 sessions/update，结果落到服务端
  const draftKey = composerKeyOf(activeId);
  const selectModel = (model: string): void => {
    if (activeId) void sessions.setModel(activeId, model);
    else composer.update(draftKey, { model });
  };
  const selectThinkingLevel = (level: ThinkingLevel): void => {
    if (activeId) void sessions.setThinkingLevel(activeId, level);
    else composer.update(draftKey, { thinkingLevel: level });
  };
  const selectMode = (mode: string): void => {
    if (activeId) void sessions.setMode(activeId, mode);
    else composer.update(draftKey, { mode });
  };
  /** 权限档位只作用于已有会话：空态不落草稿、选择器禁用，新建会话恒为默认档 */
  const selectPermissionMode = (mode: PermissionMode): void => {
    if (activeId) void sessions.setPermissionMode(activeId, mode);
  };

  /**
   * 新建会话 = 回到草稿态（输入框里没收尾的内容留着）。
   * 继承当前会话所在的项目目录：在某个项目里 `/new` 应继续待在该项目，而不是落回助理区。
   */
  const startNewSession = (): void => {
    const inWorkspace = Boolean(
      activeSession && workspacesDir && isWorkspaceSession(activeSession.cwd, workspacesDir),
    );
    const cwd = activeSession && !inWorkspace ? activeSession.cwd : undefined;
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, { cwd });
  };

  /** 「在目录中新建」：回到草稿态并把它绑到选中的目录，首条消息时才真建会话 */
  const startInDirectory = (path: string): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, { cwd: path });
  };

  /** 「小助理」：回到草稿态并清掉目录，会话落到助理工作区（不绑定项目） */
  const startAssistantSession = (): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, { cwd: undefined });
  };

  // 快捷键监听持有最新的 startNewSession：它随当前会话每次重建，用 ref 避免反复绑定监听
  const startNewSessionRef = useRef(startNewSession);
  startNewSessionRef.current = startNewSession;

  /** 置顶 / 取消置顶：乐观更新由 SDK store 处理，失败在错误条里提示 */
  const togglePin = (session: SessionSummary): void => {
    void sessions.pin(session.id, !session.pinnedAt);
  };

  const forkFrom = (item: ChatItem): void => {
    if (!activeId) return;
    void sessions.fork(activeId, item.id).then((session) => {
      if (session) setActiveId(session.id);
    });
  };

  /** `/fork`：从当前会话最新一条分叉（省略 fromEntryId，服务端取活动分支头部） */
  const forkCurrent = (): void => {
    if (!activeId) return;
    void sessions.fork(activeId).then((session) => {
      if (session) setActiveId(session.id);
    });
  };

  const requestRename = (session: SessionSummary): void => {
    setRenaming({ sessionId: session.id, name: sessionTitle(session, t("新会话")) });
  };

  /** `/goal` 命令：草稿态先建会话再设目标；其余命令作用于当前会话 */
  const runGoalCommand = (command: GoalCommand, seed: SessionCreateRequest = {}): void => {
    void (async () => {
      if (command.kind === "set") {
        if (activeId) {
          await goal.set(activeId, { objective: command.objective });
          return;
        }
        const created = await sessions.create(seed);
        if (!created) return;
        await goal.set(created.id, { objective: command.objective });
        setActiveId(created.id);
        return;
      }
      if (!activeId) {
        toast.info(t("还没有设置目标"));
        return;
      }
      switch (command.kind) {
        case "pause":
          await goal.pause(activeId);
          break;
        case "resume":
          await goal.resume(activeId);
          break;
        case "clear":
          await goal.clear(activeId);
          break;
        case "status":
          if (goal.goal) await goal.refresh(activeId);
          else toast.info(t("还没有设置目标"));
          break;
      }
    })();
  };

  const editMessage = (item: ChatItem, text: string): Promise<boolean> => chat.edit(item.id, text);

  /** 内置命令（`/` 菜单第一组）：执行界面动作，不进消息流 */
  const runBuiltin = (id: BuiltinCommandId): void => {
    switch (id) {
      case "new":
        startNewSession();
        break;
      case "rename":
        if (activeSession) requestRename(activeSession);
        break;
      case "archive": {
        if (!activeId) return;
        const id = activeId;
        void sessions.archive(id);
        composer.clear(composerKeyOf(id));
        setActiveId(null);
        break;
      }
      case "fork":
        forkCurrent();
        break;
      case "settings":
        openSettings();
        break;
      case "stop":
        void chat.stop();
        break;
      case "compact":
        if (!activeId) return;
        void chat.compact();
        break;
      case "goal":
        toast.info(t("在输入框以 /goal 开头设定或查看目标"));
        break;
      case "help":
        toast.info(t("可用内置命令见输入框的 / 菜单"), {
          description: BUILTIN_COMMANDS.map((command) => `/${command.name}`).join("  "),
        });
        break;
    }
  };

  // 全局快捷键：⌘K 搜索、⌘B 切换侧栏、⌘O 打开工作区、⌘N 新建任务（浏览器可能保留 ⌘N）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case "k":
          event.preventDefault();
          setPaletteOpen((prev) => !prev);
          break;
        case "b":
          event.preventDefault();
          toggleSidebar();
          break;
        case "o":
          event.preventDefault();
          setPicking(true);
          break;
        case "n":
          event.preventDefault();
          startNewSessionRef.current();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

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
    workspacesDir,
    activeId,
    loading: sessions.loading,
    configured,
    onSelect: setActiveId,
    onCreate: startNewSession,
    onCreateAssistant: startAssistantSession,
    onCreateInDirectory: startInDirectory,
    onRenameRequest: requestRename,
    onArchive: (id: string) => {
      void sessions.archive(id);
      composer.clear(composerKeyOf(id));
    },
    onTogglePin: togglePin,
    onOpenSearch: () => setPaletteOpen(true),
    onOpenWorkspace: () => setPicking(true),
    onOpenAutomation: () => toast.info(t("自动化功能即将推出")),
    onOpenMarketplace: () => toast.info(t("插件市场即将推出")),
    onOpenSettings: openSettings,
    childrenByParent: sessions.childrenByParent,
    childrenLoading: sessions.childrenLoading,
    onLoadChildren: sessions.loadChildren,
    activeParentId: activeSession?.parentSessionId ?? null,
  };

  return (
    <TooltipProvider>
      <WorkbenchProvider value={workbenchApi}>
        <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
          {/* 桌面端三栏分栏；窄屏只有对话区，侧栏与工作台走下方抽屉 */}
          <ResizablePanelGroup
            id={`${PANEL_IDS.sidebar}-group`}
            orientation="horizontal"
            onLayoutChanged={panels.onLayoutChanged}
          >
            {isDesktop && !sidebarCollapsed ? (
              <>
                <ResizablePanel
                  id={SIDEBAR_PANEL.id}
                  defaultSize={panels.defaultSizeOf(SIDEBAR_PANEL)}
                  minSize={SIDEBAR_PANEL.min}
                  maxSize={SIDEBAR_PANEL.max}
                  className="min-w-0"
                >
                  <div className="flex h-full w-full">
                    <SessionSidebar {...sidebarProps} />
                  </div>
                </ResizablePanel>
                <ResizableHandle id={HANDLE_IDS.sidebar} />
              </>
            ) : null}

            <ResizablePanel id={PANEL_IDS.chat} className="min-w-0">
              <div className="flex h-full w-full">
                <ChatPanel
                  session={activeSession}
                  models={models.data}
                  workspacesDir={workspacesDir}
                  chat={chat}
                  composer={composer}
                  empty={
                    <WelcomePanel
                      configured={configured}
                      defaultModel={models.data?.defaultModel ?? null}
                      workspacesDir={workspacesDir}
                      onOpenSettings={openSettings}
                    />
                  }
                  onReloadModels={() => void models.refresh()}
                  onSelectModel={selectModel}
                  onSelectThinkingLevel={selectThinkingLevel}
                  onSelectMode={selectMode}
                  onSelectPermissionMode={selectPermissionMode}
                  onOpenSettings={openSettings}
                  onOpenSession={setActiveId}
                  onToggleSidebar={() => {
                    // 桌面端切换收起，移动端唤出抽屉
                    if (isDesktop) toggleSidebar();
                    else setSidebarOpen(true);
                  }}
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleWorkbench={() => {
                    // 桌面端已展开就收起；否则展开到默认标签。移动端一律唤出抽屉
                    if (workbenchOpen) setWorkbenchOpen(false);
                    else showWorkbench();
                  }}
                  workbenchOpen={workbenchOpen}
                  onNewTask={startNewSession}
                  onFork={forkFrom}
                  onEdit={editMessage}
                  forkedFromName={forkSourceName}
                  goal={goal.goal}
                  onGoalCommand={runGoalCommand}
                  usage={sessionUsage.usage}
                  context={sessionUsage.context}
                  onOpenUsage={() => setUsageOpen(true)}
                  onBackToParent={() => {
                    const parentId = activeSession?.parentSessionId;
                    if (parentId) setActiveId(parentId);
                  }}
                  planReady={planReady}
                  onApprovePlan={approvePlan}
                  onIgnorePlan={ignorePlan}
                  onFeedbackPlan={(text) => void chat.send(textPayload(text))}
                  onBuiltin={runBuiltin}
                />
              </div>
            </ResizablePanel>

            {isDesktop && workbenchOpen ? (
              <>
                {/* 命中区即两栏之间的间距：工作台侧收窄一点（8px），与卡片自身的 m-2 对齐 */}
                <ResizableHandle id={HANDLE_IDS.workbench} className="w-2" />
                <ResizablePanel
                  id={WORKBENCH_PANEL.id}
                  defaultSize={panels.defaultSizeOf(WORKBENCH_PANEL)}
                  minSize={WORKBENCH_PANEL.min}
                  maxSize={WORKBENCH_PANEL.max}
                  className="min-w-0"
                >
                  <div className="flex h-full w-full md:py-2 md:pr-2">
                    <div className="flex h-full w-full overflow-hidden bg-card md:rounded-xl md:border md:border-border">
                      <WorkbenchPanel />
                    </div>
                  </div>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>

          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent title={t("会话列表")} className="md:hidden">
              <SessionSidebar
                {...sidebarProps}
                onSelect={(id) => {
                  setActiveId(id);
                  setSidebarOpen(false);
                }}
                onCreate={() => {
                  startNewSession();
                  setSidebarOpen(false);
                }}
                onCreateAssistant={() => {
                  startAssistantSession();
                  setSidebarOpen(false);
                }}
                onCreateInDirectory={(path) => {
                  startInDirectory(path);
                  setSidebarOpen(false);
                }}
                onOpenSettings={() => {
                  setSidebarOpen(false);
                  openSettings();
                }}
              />
            </SheetContent>
          </Sheet>

          <Sheet open={workbenchSheetOpen} onOpenChange={setWorkbenchSheetOpen}>
            <SheetContent side="right" title={t("工作台")} className="md:hidden">
              <WorkbenchPanel />
            </SheetContent>
          </Sheet>

          <PermissionDialog
            request={interaction?.kind === "permission" ? interaction : null}
            onRespond={(requestId, decision) =>
              void interactions.respond({ requestId, kind: "permission", decision })
            }
          />

          <QuestionDialog
            request={interaction?.kind === "question" ? interaction : null}
            onRespond={(requestId, answers) =>
              void interactions.respond({ requestId, kind: "question", answers })
            }
          />

          <UsagePanel
            open={usageOpen}
            onOpenChange={setUsageOpen}
            onOpenSession={setActiveId}
            context={sessionUsage.context}
          />

          <RenameSessionDialog
            target={renaming}
            onOpenChange={(open) => {
              if (!open) setRenaming(null);
            }}
            onSubmit={(id, name) => void sessions.rename(id, name)}
          />

          {settingsSection ? (
            <SettingsPanel
              section={settingsSection}
              onSectionChange={setSettingsSection}
              onClose={() => setSettingsSection(null)}
              onSaved={() => {
                void models.reload();
              }}
            />
          ) : null}

          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            sessions={sessionsView}
            fileRoot={activeSession?.cwd ?? workspacesDir}
            onSelectSession={setActiveId}
            onRunBuiltin={runBuiltin}
            onNewTask={startNewSession}
            onNewAssistant={startAssistantSession}
            onOpenWorkspace={() => setPicking(true)}
            onOpenSettings={openSettings}
            onToggleSidebar={toggleSidebar}
            onToggleWorkbench={() => {
              if (workbenchOpen) setWorkbenchOpen(false);
              else showWorkbench();
            }}
            onOpenFile={openPreview}
          />

          <DirectoryPickerDialog
            open={picking}
            onOpenChange={setPicking}
            onSelect={(path) => {
              startInDirectory(path);
              setPicking(false);
            }}
          />

          <Toaster position="top-center" />
          <ErrorToaster />
        </div>
      </WorkbenchProvider>
    </TooltipProvider>
  );
}
