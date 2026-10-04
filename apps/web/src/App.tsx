/** 应用外壳：会话侧栏 + 对话区 + 设置对话框 */

import { ChatPanel } from "@ucode/ui/components/chat-panel";
import { PermissionDialog } from "@ucode/ui/components/permission-dialog";
import { QuestionDialog } from "@ucode/ui/components/question-dialog";
import { RenameSessionDialog } from "@ucode/ui/components/rename-session-dialog";
import { SessionSidebar } from "@ucode/ui/components/session-sidebar";
import { SettingsDialog } from "@ucode/ui/components/settings/settings-dialog";
import { Sheet, SheetContent } from "@ucode/ui/components/ui/sheet";
import { Toaster } from "@ucode/ui/components/ui/sonner";
import { TooltipProvider } from "@ucode/ui/components/ui/tooltip";
import { UsageDialog } from "@ucode/ui/components/usage-dialog";
import { WelcomePanel } from "@ucode/ui/components/welcome-panel";
import { useGoal } from "@ucode/ui/hooks/use-goal";
import { useInteractions } from "@ucode/ui/hooks/use-interactions";
import { useSessionUsage } from "@ucode/ui/hooks/use-session-usage";
import { useWorkspace } from "@ucode/ui/hooks/use-workspace";
import { api, describeError } from "@ucode/ui/lib/api";
import { BUILTIN_COMMANDS, type BuiltinCommandId } from "@ucode/ui/lib/builtin-commands";
import { composerKeyOf, NEW_SESSION_KEY } from "@ucode/ui/lib/composer-draft";
import { textPayload } from "@ucode/ui/lib/composer-payload";
import type { GoalCommand } from "@ucode/ui/lib/goal-command";
import { lastTurnPresentedPlan } from "@ucode/ui/lib/plan";
import { sessionTitle } from "@ucode/ui/lib/session";
import { isWorkspaceSession } from "@ucode/ui/lib/session-groups";
import type {
  ChatItem,
  SessionCreateRequest,
  SessionSummary,
  ThinkingLevel,
} from "@ucode/ui/lib/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export default function App() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const { sessions, models, configured, activeId, activeSession, chat, workspaceRoot } = workspace;
  const { composer, setActiveId } = workspace;
  const interactions = useInteractions(activeId);
  const goal = useGoal(activeId);
  const [usageOpen, setUsageOpen] = useState(false);
  /** 移动端会话侧栏抽屉 */
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 拉宽到桌面断点时自动收起抽屉，避免被已隐藏的菜单按钮困在遮罩里
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = (): void => {
      if (mql.matches) setSidebarOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  /** 重命名对话框的目标；侧栏右键与 `/rename` 命令共用同一个对话框 */
  const [renaming, setRenaming] = useState<{ sessionId: string; name: string } | null>(null);
  // 本会话累计用量：切换会话时取一次，生成落定后刷新
  const sessionUsage = useSessionUsage(activeSession?.id ?? null, chat.streaming);
  // 界面一次只展示最早的待答请求；权限审批与提问各自按 kind 分发
  const interaction = interactions.pending[0] ?? null;

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

  /**
   * 新建会话 = 回到草稿态（输入框里没收尾的内容留着，见 lib/composer-draft）。
   * 继承当前会话所在的项目目录：在某个项目里 `/new` 应继续待在该项目，而不是落回助理区；
   * 助理区（未绑定目录）会话不继承，否则新会话会被绑到上一个会话的 workspace 目录上。
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

  /** 从某条消息分叉出新会话，成功后切过去 */
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

  /** 打开重命名对话框（侧栏右键 / `/rename`） */
  const requestRename = (session: SessionSummary): void => {
    setRenaming({ sessionId: session.id, name: sessionTitle(session, t("新会话")) });
  };

  /**
   * `/goal` 命令：草稿态先建会话再设目标；其余命令作用于当前会话。
   * 目标模式只在编码模式可用，服务端会再校验一次。
   */
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

  /** 编辑用户消息并重发；分支与刷新由服务端推进（transcript_reset 事件触发重取快照） */
  const editMessage = (item: ChatItem, text: string): Promise<boolean> => chat.edit(item.id, text);

  /**
   * 内置命令（`/` 菜单第一组）：执行界面动作，不进消息流。
   * `/models`、`/thinking`、`/mode` 由输入区就地打开工具栏里的选择器，不经过这里。
   */
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
        // 归档后这个会话的输入草稿也没有再恢复的意义
        composer.clear(composerKeyOf(id));
        setActiveId(null);
        break;
      }
      case "fork":
        forkCurrent();
        break;
      case "settings":
        workspace.setSettingsOpen(true);
        break;
      case "stop":
        void chat.stop();
        break;
      case "compact":
        if (!activeId) return;
        void api.messages.compact({ sessionId: activeId }).catch((error) => {
          toast.error(describeError(error));
        });
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

  const sidebarProps = {
    sessions: sessions.sessions,
    workspaceRoot,
    activeId,
    loading: sessions.loading,
    configured,
    onSelect: setActiveId,
    onCreate: startNewSession,
    onCreateInDirectory: startInDirectory,
    onRenameRequest: requestRename,
    onDelete: (sessionId: string) => {
      void sessions.archive(sessionId);
      // 归档后这个会话的输入草稿也没有再恢复的意义
      composer.clear(composerKeyOf(sessionId));
    },
    onOpenSettings: () => workspace.setSettingsOpen(true),
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
              onSelect={(sessionId) => {
                setActiveId(sessionId);
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
                workspace.setSettingsOpen(true);
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
              onOpenSettings={() => workspace.setSettingsOpen(true)}
            />
          }
          onReloadModels={() => void models.refresh()}
          onSelectModel={selectModel}
          onSelectThinkingLevel={selectThinkingLevel}
          onSelectMode={selectMode}
          onOpenSettings={() => workspace.setSettingsOpen(true)}
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
          onSubmit={(sessionId, name) => void sessions.rename(sessionId, name)}
        />

        <SettingsDialog
          open={workspace.settingsOpen}
          onOpenChange={workspace.setSettingsOpen}
          onSaved={workspace.handleSettingsSaved}
        />
        <Toaster position="top-center" />
      </div>
    </TooltipProvider>
  );
}
