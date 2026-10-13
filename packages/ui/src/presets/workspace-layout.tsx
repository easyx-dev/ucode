/**
 * 预设：把侧栏、对话区、输入区与各对话框组合成一套完整工作区。
 *
 * 只接收受控的导航状态；产品行为（内置命令、计划批准、目标命令、会话动作）都在这里，
 * 应用层只需提供导航 props。需要更细的组合时自行用 `@ucode/ui/business/*` 拼装。
 */
import { brand } from "@ucode/brand";
import type { GitCommitSummary } from "@ucode/contracts";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../base/resizable";
import { Sheet, SheetContent } from "../base/sheet";
import { Toaster } from "../base/sonner";
import { TooltipProvider } from "../base/tooltip";
import { ChatPanel } from "../business/chat-panel";
import { CommandPalette } from "../business/command-palette";
import { DialogHost } from "../business/dialog-host";
import { openDirectoryPickerDialog } from "../business/directory-picker-dialog";
import { ErrorToaster } from "../business/error-toaster";
import { openRenameProjectDialog } from "../business/rename-project-dialog";
import { openRenameSessionDialog } from "../business/rename-session-dialog";
import { SessionSidebar } from "../business/session-sidebar";
import { SettingsPanel } from "../business/settings/settings-panel";
import { UsagePanel } from "../business/usage/usage-panel";
import { WorkbenchPanel } from "../business/workbench/workbench-panel";
import { useActiveSession } from "../hooks/use-active-session";
import { useChat } from "../hooks/use-chat";
import { useComposerDrafts } from "../hooks/use-composer-drafts";
import { useConnectionResync } from "../hooks/use-connection-resync";
import { useGoal } from "../hooks/use-goal";
import { useInteractions } from "../hooks/use-interactions";
import { useIsDesktop } from "../hooks/use-is-desktop";
import { useModels } from "../hooks/use-models";
import { usePanelLayout } from "../hooks/use-panel-layout";
import { useProjects } from "../hooks/use-projects";
import { useSessionNotices } from "../hooks/use-session-notices";
import { useSessionUsage } from "../hooks/use-session-usage";
import { useSessions } from "../hooks/use-sessions";
import { useStatus } from "../hooks/use-status";
import { useWorkbenchDocs } from "../hooks/use-workbench-docs";
import { BUILTIN_COMMANDS, type BuiltinCommandId } from "../lib/builtin-commands";
import { compactionNoticeMessage } from "../lib/compaction";
import { textToDoc } from "../lib/composer-document";
import { type ComposerDraft, composerKeyOf, NEW_SESSION_KEY } from "../lib/composer-draft";
import { textPayload } from "../lib/composer-payload";
import { errorText } from "../lib/error";
import type { GoalCommand } from "../lib/goal-command";
import {
  CHAT_MIN_WIDTH,
  fitPanelDefault,
  HANDLE_IDS,
  PANEL_IDS,
  SIDEBAR_PANEL,
  WORKBENCH_PANEL,
  WORKSPACE_PANELS,
  workbenchAvailableWidth,
} from "../lib/panel-layout";
import { lastTurnPresentedPlan } from "../lib/plan";
import { projectOf, projectSeedOf } from "../lib/project";
import { isWorkspaceSession } from "../lib/session-groups";
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from "../lib/settings-section";
import { readStorage, writeStorage } from "../lib/storage";
import type {
  ChatItem,
  EditMessagePayload,
  PermissionMode,
  SessionCreateRequest,
  SessionSummary,
  ThinkingPreference,
} from "../lib/types";
import { changeDoc, changesDoc, commitDoc, fileDoc } from "../lib/workbench-docs";
import { readWorkbenchOpen, writeWorkbenchOpen } from "../lib/workbench-prefs";
import { useClient } from "../provider";
import { type ChangeTarget, WorkbenchProvider, type WorkbenchView } from "../provider/workbench";

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
};

/** 侧栏收起状态的持久化键 */
const SIDEBAR_COLLAPSED_KEY = `${brand.slug}-sidebar-collapsed`;

/** 读出上次的侧栏收起状态；读不到时默认展开 */
const readSidebarCollapsed = (): boolean => readStorage(SIDEBAR_COLLAPSED_KEY) === "1";

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
}: WorkspaceLayoutProps) {
  const { t } = useTranslation();
  const sessions = useSessions();
  const models = useModels();
  const projects = useProjects();
  const workspacesDir = useStatus()?.workspace ?? null;
  const composer = useComposerDrafts();
  // 会话归档 / id 失效时把选中项清回空态
  const client = useClient();
  const activeSession = useActiveSession(activeId, () => setActiveId(null));
  const interactions = useInteractions(activeId);
  const goal = useGoal(activeId);
  // 唯一通知触发点：web 与桌面端都在这里判定，点开通知即切到那条会话
  useSessionNotices({ onSelectSession: setActiveId });
  /**
   * 当前工作目录：已有会话用它自己的工作目录；草稿态还没有会话，用草稿里选中的目录——
   * 「在某个项目里新建」时工作台与命令面板的文件检索都该落在那个项目上，而不是助理工作区。
   */
  const draftCwd = activeId ? null : (composer.drafts[NEW_SESSION_KEY]?.cwd ?? null);
  // 编辑器区的文档标签：工作目录变化即整体清空（见 use-workbench-docs）
  const workbenchCwd = activeSession?.cwd ?? draftCwd ?? workspacesDir;
  // 工作台显隐按项目记忆：助理工作区与草稿态没有项目，回落全局键
  const workbenchProjectId = projectOf(projects.projects, workbenchCwd)?.id ?? null;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  // 工作台：展开状态刷新后仍保持（宽度另有 usePanelLayout 管）；标签、树列可见性与预览目标一并受控
  const [workbenchOpen, setWorkbenchOpen] = useState(() => readWorkbenchOpen(workbenchProjectId));
  // 侧栏视图与是否展开：都不落盘——面板收起后再打开回到默认视图（代码管理，最常看）
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>("changes");
  const [workbenchSidebarVisible, setWorkbenchSidebarVisible] = useState(true);
  const [workbenchSheetOpen, setWorkbenchSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const isDesktop = useIsDesktop();
  // 外层三栏一组：侧栏与工作台各自记住宽度，对话区占剩余
  const panels = usePanelLayout("workspace", WORKSPACE_PANELS);

  /**
   * 自绘窗口控件的纵向位置：展开时它落在侧栏顶部空区，中线取对话区头部那行的控件中线再减去
   * 内容卡距窗口顶的间距（点属窗口镶边，不该被内容卡的上留白推下去，那一段就是外壳容器
   * `p-shell-inset` 的顶边留白）；收起时它就在头部那一行里，中线直接取那行的控件中线（跟行对齐）。
   * 两种情况都是实测值，写到 `<html>` 上交给壳层，壳层的拖拽条读数定位——两边都不需要知道对方的几何。
   */
  useEffect(() => {
    if (titleBarInset === 0) return;
    const header = document.querySelector('[data-slot="chat-header"]');
    // 卡片就是头部的父节点，它距窗口顶的那一段就是要减掉的间距
    const card = header?.parentElement;
    if (!header || !card) return;
    // 对齐目标是头部里「真控件」的中线：要排掉窗口控件自己（它也挂在头部里，量它会自我引用）
    const anchor =
      Array.from(header.querySelectorAll("button")).find(
        (button) => !button.closest("[data-window-controls]"),
      ) ?? header;
    const overSidebar = isDesktop && !sidebarCollapsed;
    const publish = (): void => {
      const rect = anchor.getBoundingClientRect();
      const centered = rect.top + rect.height / 2;
      const line = overSidebar ? centered - card.getBoundingClientRect().top : centered;
      document.documentElement.style.setProperty("--window-controls-center", `${line}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    observer.observe(anchor);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--window-controls-center");
    };
  }, [isDesktop, sidebarCollapsed, titleBarInset]);

  const configured = models.data?.configured ?? false;

  /**
   * 取当前会话的原始记录（JSONL 文本）供复制。内容可能几 MB，所以只在点按钮时取。
   * 失败要说清原因（记录过大、文件读不到），否则「复制出来是空的」看不出是失败。
   */
  const loadTranscript = useCallback(async (): Promise<string> => {
    if (!activeId) return "";
    try {
      const result = await client.apis.sessions.transcript(activeId);
      return result.content;
    } catch (error) {
      toast.error(errorText(t, error));
      throw error;
    }
  }, [activeId, client, t]);
  const docs = useWorkbenchDocs(workbenchCwd);
  /** 展开工作台时的默认宽度按窗口夹取：窄窗口下 640 会把对话区压破（记忆值优先） */
  const workbenchPanelSpec = useMemo(
    () => ({
      ...WORKBENCH_PANEL,
      default: fitPanelDefault(
        WORKBENCH_PANEL,
        workbenchAvailableWidth(window.innerWidth, SIDEBAR_PANEL.default),
      ),
    }),
    [],
  );
  const chat = useChat(activeId, { onSessionCreated: setActiveId });
  // 回到前台 / 网络恢复时主动校准一次连接：后台错过的收尾帧靠定时器看门狗收敛不了（见 useConnectionResync）
  const hasActiveRun =
    chat.streaming || chat.compacting || sessions.sessions.some((session) => session.running);
  useConnectionResync(hasActiveRun);
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

  // 压缩的结果提示（内容太少 / 已压缩过 / 自动压缩失败）：不是错误，只弹一条轻提示——
  // 它们都没有对应的消息区痕迹，不提示的话用户只会看到「什么都没发生」；弹过即 ack，避免重渲染时重复弹
  const compactionNotice = chat.compactionNotice;
  const ackCompactionNotice = chat.ackCompactionNotice;
  useEffect(() => {
    if (!compactionNotice) return;
    toast.info(compactionNoticeMessage(compactionNotice, t));
    ackCompactionNotice();
  }, [compactionNotice, ackCompactionNotice, t]);

  /** 收起 / 展开侧栏并落盘；移动端抽屉由 sidebarOpen 单独管 */
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeStorage(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  /** 展开 / 收起工作台并落盘（按当前项目）；移动端抽屉由 workbenchSheetOpen 单独管 */
  const applyWorkbenchOpen = useCallback(
    (open: boolean) => {
      setWorkbenchOpen(open);
      writeWorkbenchOpen(workbenchProjectId, open);
    },
    [workbenchProjectId],
  );

  // 换项目就换一份记忆：初始化只跑一次，不重读会把上一个项目的显隐带过去
  useEffect(() => {
    setWorkbenchOpen(readWorkbenchOpen(workbenchProjectId));
  }, [workbenchProjectId]);

  /** 展开工作台；窄屏下同时唤出抽屉 */
  const showWorkbench = useCallback(() => {
    applyWorkbenchOpen(true);
    if (!isDesktop) setWorkbenchSheetOpen(true);
  }, [applyWorkbenchOpen, isDesktop]);

  /** 打开某个文件的预览：面板未展开就展开（侧栏视图不动，标签自己表达打开了什么） */
  const openFile = useCallback(
    (path: string) => {
      docs.open(fileDoc(path));
      showWorkbench();
    },
    [docs.open, showWorkbench],
  );

  /** 打开某个工作区变更的 diff */
  const openChange = useCallback(
    ({ file, staged }: ChangeTarget) => {
      if (!workbenchCwd) return;
      docs.open(changeDoc(workbenchCwd, file, staged));
      showWorkbench();
    },
    [docs.open, showWorkbench, workbenchCwd],
  );

  /** 打开某次提交的详情 */
  const openCommit = useCallback(
    (commit: GitCommitSummary) => {
      if (!workbenchCwd) return;
      docs.open(commitDoc(workbenchCwd, commit));
      showWorkbench();
    },
    [docs.open, showWorkbench, workbenchCwd],
  );

  /**
   * 切换工作台。
   * 窄屏下工作台是抽屉，开关由 `workbenchSheetOpen` 管，同一个按钮就应当开关它——
   * 「一律唤出」会让按钮在抽屉已开时显示「收起」却收不起来。
   */
  const toggleWorkbench = useCallback(() => {
    if (!isDesktop) {
      setWorkbenchSheetOpen((prev) => !prev);
      // 抽屉用过一次就记住「工作台已启用」，桌面端切回来时依旧可见
      applyWorkbenchOpen(true);
      return;
    }
    if (workbenchOpen) applyWorkbenchOpen(false);
    else showWorkbench();
  }, [applyWorkbenchOpen, isDesktop, showWorkbench, workbenchOpen]);

  /** 打开「全部改动」：面板未展开就展开，所有变更文件的 diff 堆叠到同一份文档里 */
  const openChanges = useCallback(() => {
    if (!workbenchCwd) return;
    docs.open(changesDoc(workbenchCwd));
    showWorkbench();
  }, [docs.open, showWorkbench, workbenchCwd]);

  /** 活动栏：点当前视图即收起侧栏，点另一个视图即切换并展开 */
  const selectWorkbenchView = useCallback(
    (view: WorkbenchView) => {
      setWorkbenchSidebarVisible((visible) => (view === workbenchView ? !visible : true));
      setWorkbenchView(view);
    },
    [workbenchView],
  );

  /** 工作台的动作面：面板状态在预设里受控，业务组件只经这里拿动作 */
  const workbenchApi = useMemo(
    () => ({
      view: workbenchView,
      selectView: selectWorkbenchView,
      sidebarVisible: workbenchSidebarVisible,
      toggleSidebar: () => setWorkbenchSidebarVisible((prev) => !prev),
      setSidebarVisible: setWorkbenchSidebarVisible,
      docs: docs.docs,
      activeDocId: docs.activeDocId,
      selectDoc: docs.select,
      closeDoc: docs.close,
      closeOtherDocs: docs.closeOthers,
      closeAllDocs: docs.closeAll,
      openFile,
      openChange,
      openCommit,
      openChanges,
      /**
       * 收起整个面板。
       * 窄屏下工作台是抽屉，开关由 `workbenchSheetOpen` 单独管——只改 `workbenchOpen` 是看不见效果的，
       * 活动栏的「收起面板」在移动端点了没反应就是这个原因。
       */
      collapse: () => {
        applyWorkbenchOpen(false);
        if (!isDesktop) setWorkbenchSheetOpen(false);
      },
      cwd: workbenchCwd,
    }),
    [
      applyWorkbenchOpen,
      docs.activeDocId,
      docs.close,
      docs.closeAll,
      docs.closeOthers,
      docs.docs,
      docs.select,
      isDesktop,
      openChange,
      openCommit,
      openChanges,
      openFile,
      selectWorkbenchView,
      setWorkbenchSidebarVisible,
      workbenchCwd,
      workbenchSidebarVisible,
      workbenchView,
    ],
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

  /** 批准计划：先切回编码模式（模式的校验与生效在服务端），再让服务端注入开工指令 */
  const approvePlan = (): void => {
    if (!activeId) return;
    void (async () => {
      await sessions.setMode(activeId, "build");
      await chat.approvePlan();
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
  const selectThinkingLevel = (level: ThinkingPreference): void => {
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
   * 草稿的初始设置按目录所属的项目填：项目记住的模型 / 档位 / 模式 / 权限档位直接带进去，
   * 没记住的目录把这四项清空，由服务端回落全局默认——`/new`、目录选择、小助理共用这一条路径。
   */
  const seedDraftFor = (cwd: string | undefined): Partial<ComposerDraft> => ({
    cwd,
    ...projectSeedOf(projectOf(projects.projects, cwd ?? null)),
  });

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
    composer.update(NEW_SESSION_KEY, seedDraftFor(cwd));
  };

  /** 「在目录中新建」：回到草稿态并把它绑到选中的目录，首条消息时才真建会话 */
  const startInDirectory = (path: string): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, seedDraftFor(path));
  };

  /** 「小助理」：回到草稿态并清掉目录，会话落到助理工作区（不绑定项目） */
  const startAssistantSession = (): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, seedDraftFor(undefined));
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

  /** 请求重命名：弹层自己管开关，拿到新名称再提交 */
  const requestRename = (session: SessionSummary): void => {
    void openRenameSessionDialog(session).then((name) => {
      if (name) void sessions.rename(session.id, name);
    });
  };

  /** 请求重命名项目：清空输入即回落目录名（弹层给 null），取消不提交 */
  const requestRenameProject = (path: string): void => {
    const project = projectOf(projects.projects, path);
    void openRenameProjectDialog({ path, name: project?.name ?? null }).then((name) => {
      if (name === undefined) return;
      void projects.rename({ path, name });
    });
  };

  /** 选目录（⌘O / 侧栏 / 命令面板共用）：选中的目录成为草稿的工作目录 */
  const pickDirectory = (): void => {
    void openDirectoryPickerDialog().then((path) => {
      if (path) startInDirectory(path);
    });
  };

  // 快捷键监听同上：pickDirectory 也随会话重建，经 ref 取最新
  const pickDirectoryRef = useRef(pickDirectory);
  pickDirectoryRef.current = pickDirectory;

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

  const editMessage = (item: ChatItem, payload: EditMessagePayload): Promise<boolean> =>
    chat.edit(item.id, payload);

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
      case "goal": {
        // 目标要用户自己写：把命令名放到正文最前面，已有内容原样留在后面当目标文本
        // （编辑器里选中 `/goal` 是同一个效果：只替换命令名那一段，不碰文档其余部分）
        if (!activeId) return;
        const key = composerKeyOf(activeId);
        const current = composer.drafts[key]?.text.trim() ?? "";
        if (current.startsWith("/goal")) break;
        const command = current ? `/goal ${current}` : "/goal ";
        composer.update(key, { text: command, doc: textToDoc(command) });
        break;
      }
      case "help":
        toast.info(t("可用内置命令见输入框的 / 菜单"), {
          description: BUILTIN_COMMANDS.map((command) =>
            command.argumentHint
              ? `/${command.name} <${command.argumentHint}>`
              : `/${command.name}`,
          ).join("  "),
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
          pickDirectoryRef.current();
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

  /**
   * 对话区头部此时是否占据窗口左端：桌面端看侧栏是否收起，窄屏看抽屉（侧栏不常驻，头部始终在窗左）。
   * 自绘窗口控件的归属就按它分：占据左端时挂在头部，否则挂在侧栏顶部那条里。
   */
  const headerOwnsLeftEdge = isDesktop ? sidebarCollapsed : !sidebarOpen;

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
    onCreate: startNewSession,
    onCreateAssistant: startAssistantSession,
    onCreateInDirectory: startInDirectory,
    onRenameProject: requestRenameProject,
    onReorderProjects: (paths: string[]) => {
      void projects.reorder(paths);
    },
    onArchive: (id: string) => {
      void sessions.archive(id);
      composer.clear(composerKeyOf(id));
    },
    onTogglePin: togglePin,
    onOpenSearch: () => setPaletteOpen(true),
    onOpenWorkspace: pickDirectory,
    onOpenAutomation: () => toast.info(t("自动化功能即将推出")),
    onOpenMarketplace: () => toast.info(t("插件市场即将推出")),
    onOpenSettings: openSettings,
  };

  return (
    <TooltipProvider>
      <WorkbenchProvider value={workbenchApi}>
        {/* 四周留白见 DESIGN.md「间距与尺寸」：外壳容器统一留，内容卡不再自己留 margin */}
        {/* 外壳是最底层，用玻璃面 + 模糊：窗口透明或加了背景图之后它会透出后面那层 */}
        <div className="flex h-dvh w-full overflow-hidden bg-glass text-foreground backdrop-blur-sm md:p-shell-inset">
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
                  onSelectModel={selectModel}
                  onSelectThinkingLevel={selectThinkingLevel}
                  onSelectMode={selectMode}
                  onSelectPermissionMode={selectPermissionMode}
                  onOpenSettings={openSettings}
                  onOpenSession={setActiveId}
                  onToggleSidebar={() => {
                    // 桌面端切换收起，窄屏开关抽屉（与按钮上显示的图标保持一致）
                    if (isDesktop) toggleSidebar();
                    else setSidebarOpen((prev) => !prev);
                  }}
                  sidebarCollapsed={headerOwnsLeftEdge}
                  titleBarInset={titleBarInset}
                  /*
                    判据是「无标题栏」而不是桌面断点：非 macOS 传进来的 titleBarInset 为 0，
                    这三颗点一次都不该渲染（那是系统控件的地盘）；窄屏侧栏不常驻，让位区也跟着不在了
                  */
                  windowControlsWidth={
                    titleBarInset > 0 && headerOwnsLeftEdge ? windowControlsWidth : 0
                  }
                  windowControls={
                    titleBarInset > 0 && headerOwnsLeftEdge ? windowControls : undefined
                  }
                  onToggleWorkbench={toggleWorkbench}
                  workbenchOpen={isDesktop ? workbenchOpen : workbenchSheetOpen}
                  onRenameSession={activeSession ? () => requestRename(activeSession) : undefined}
                  onLoadTranscript={activeId ? loadTranscript : undefined}
                  onFork={forkFrom}
                  onEdit={editMessage}
                  forkedFromName={forkSourceName}
                  goal={goal.goal}
                  onGoalCommand={runGoalCommand}
                  onGoalBudget={(tokenBudget) => {
                    if (activeId) void goal.setBudget(activeId, tokenBudget);
                  }}
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
                  interaction={interaction}
                  onRespondInteraction={(input) => void interactions.respond(input)}
                  onBuiltin={runBuiltin}
                />
              </div>
            </ResizablePanel>

            {isDesktop && workbenchOpen ? (
              <>
                {/* 两栏之间只留 `--shell-inset`（与外壳四周同宽）：命中区仍占 8px，靠 `-ml-1` 叠进对话区右边缘 */}
                <ResizableHandle id={HANDLE_IDS.workbench} className="-ml-1 w-2" />
                <ResizablePanel
                  id={WORKBENCH_PANEL.id}
                  defaultSize={panels.defaultSizeOf(workbenchPanelSpec)}
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
            onNewTask={startNewSession}
            onNewAssistant={startAssistantSession}
            onOpenWorkspace={pickDirectory}
            onOpenSettings={openSettings}
            onToggleSidebar={toggleSidebar}
            onToggleWorkbench={toggleWorkbench}
            onOpenFile={openFile}
          />

          <Toaster position="top-center" />
          <DialogHost />
          <ErrorToaster />
        </div>
      </WorkbenchProvider>
    </TooltipProvider>
  );
}
