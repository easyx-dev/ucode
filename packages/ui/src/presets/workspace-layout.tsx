/**
 * 预设：把侧栏、对话区、输入区与各对话框组合成一套完整工作区。
 *
 * 只接收受控的导航状态；产品行为（内置命令、计划批准、目标命令、会话动作）都在这里，
 * 应用层只需提供导航 props。需要更细的组合时自行用 `@ucode/ui/business/*` 拼装。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Sheet, SheetContent } from "../base/sheet";
import { Toaster } from "../base/sonner";
import { TooltipProvider } from "../base/tooltip";
import { ChatPanel } from "../business/chat-panel";
import { ErrorToaster } from "../business/error-toaster";
import { PermissionDialog } from "../business/permission-dialog";
import { QuestionDialog } from "../business/question-dialog";
import { RenameSessionDialog } from "../business/rename-session-dialog";
import { SessionSidebar } from "../business/session-sidebar";
import { SettingsDialog } from "../business/settings/settings-dialog";
import { UsageDialog } from "../business/usage-dialog";
import { WelcomePanel } from "../business/welcome-panel";
import { useActiveSession } from "../hooks/use-active-session";
import { useChat } from "../hooks/use-chat";
import { useComposerDrafts } from "../hooks/use-composer-drafts";
import { useGoal } from "../hooks/use-goal";
import { useInteractions } from "../hooks/use-interactions";
import { useModels } from "../hooks/use-models";
import { useSessionUsage } from "../hooks/use-session-usage";
import { useSessions } from "../hooks/use-sessions";
import { useStatus } from "../hooks/use-status";
import { BUILTIN_COMMANDS, type BuiltinCommandId } from "../lib/builtin-commands";
import { composerKeyOf, NEW_SESSION_KEY } from "../lib/composer-draft";
import { textPayload } from "../lib/composer-payload";
import type { GoalCommand } from "../lib/goal-command";
import { lastTurnPresentedPlan } from "../lib/plan";
import { sessionTitle } from "../lib/session";
import { isWorkspaceSession } from "../lib/session-groups";
import type {
  ChatItem,
  PermissionMode,
  SessionCreateRequest,
  SessionSummary,
  ThinkingLevel,
} from "../lib/types";

export type WorkspaceLayoutProps = {
  /** 当前选中的会话；null 表示草稿态（新建） */
  sessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  usageOpen: boolean;
  onUsageOpenChange: (open: boolean) => void;
};

export function WorkspaceLayout({
  sessionId: activeId,
  onSelectSession: setActiveId,
  settingsOpen,
  onSettingsOpenChange: setSettingsOpen,
  usageOpen,
  onUsageOpenChange: setUsageOpen,
}: WorkspaceLayoutProps) {
  const { t } = useTranslation();
  const sessions = useSessions();
  const models = useModels();
  const workspaceRoot = useStatus()?.workspace ?? null;
  const composer = useComposerDrafts();
  // 会话归档 / id 失效时把选中项清回空态
  const activeSession = useActiveSession(activeId, () => setActiveId(null));
  const interactions = useInteractions(activeId);
  const goal = useGoal(activeId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ sessionId: string; name: string } | null>(null);

  const configured = models.data?.configured ?? false;
  const chat = useChat(activeId, { onSessionCreated: setActiveId });
  const sessionUsage = useSessionUsage(activeId);
  const interaction = interactions.pending[0] ?? null;

  // 拉宽到桌面断点时自动收起抽屉，避免被已隐藏的菜单按钮困在遮罩里
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = (): void => {
      if (mql.matches) setSidebarOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

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
      activeSession && workspaceRoot && isWorkspaceSession(activeSession.cwd, workspaceRoot),
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
        setSettingsOpen(true);
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
    workspaceRoot,
    activeId,
    loading: sessions.loading,
    configured,
    onSelect: setActiveId,
    onCreate: startNewSession,
    onCreateInDirectory: startInDirectory,
    onRenameRequest: requestRename,
    onDelete: (id: string) => {
      void sessions.archive(id);
      composer.clear(composerKeyOf(id));
    },
    onOpenSettings: () => setSettingsOpen(true),
    childrenByParent: sessions.childrenByParent,
    childrenLoading: sessions.childrenLoading,
    onLoadChildren: sessions.loadChildren,
    activeParentId: activeSession?.parentSessionId ?? null,
  };

  return (
    <TooltipProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        {/* 桌面端固定侧栏；移动端收进抽屉 */}
        <div className="hidden h-full w-72 shrink-0 md:flex">
          <SessionSidebar {...sidebarProps} />
        </div>

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
              onCreateInDirectory={(path) => {
                startInDirectory(path);
                setSidebarOpen(false);
              }}
              onOpenSettings={() => {
                setSidebarOpen(false);
                setSettingsOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>

        <ChatPanel
          session={activeSession}
          models={models.data}
          workspaceRoot={workspaceRoot}
          chat={chat}
          composer={composer}
          empty={
            <WelcomePanel
              configured={configured}
              defaultModel={models.data?.defaultModel ?? null}
              workspaceRoot={workspaceRoot}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          }
          onReloadModels={() => void models.refresh()}
          onSelectModel={selectModel}
          onSelectThinkingLevel={selectThinkingLevel}
          onSelectMode={selectMode}
          onSelectPermissionMode={selectPermissionMode}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSession={setActiveId}
          onOpenSidebar={() => setSidebarOpen(true)}
          onFork={forkFrom}
          onEdit={editMessage}
          forkedFromName={forkSourceName}
          goal={goal.goal}
          onGoalCommand={runGoalCommand}
          usage={sessionUsage}
          onOpenUsage={() => setUsageOpen(true)}
          onBackToParent={() => {
            const parentId = activeSession?.parentSessionId;
            if (parentId) setActiveId(parentId);
          }}
          planReady={planReady}
          onApprovePlan={approvePlan}
          onFeedbackPlan={(text) => void chat.send(textPayload(text))}
          onBuiltin={runBuiltin}
        />

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

        <UsageDialog open={usageOpen} onOpenChange={setUsageOpen} onOpenSession={setActiveId} />

        <RenameSessionDialog
          target={renaming}
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          onSubmit={(id, name) => void sessions.rename(id, name)}
        />

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSaved={() => {
            void models.reload();
          }}
        />
        <Toaster position="top-center" />
        <ErrorToaster />
      </div>
    </TooltipProvider>
  );
}
