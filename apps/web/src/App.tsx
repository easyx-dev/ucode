/** 应用外壳：会话侧栏 + 对话区 + 设置对话框 */
import { useTranslation } from "react-i18next";

import { ChatPanel } from "@/components/chat-panel";
import { PermissionDialog } from "@/components/permission-dialog";
import { SessionSidebar } from "@/components/session-sidebar";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomePanel } from "@/components/welcome-panel";
import { useInteractions } from "@/hooks/use-interactions";
import { useWorkspace } from "@/hooks/use-workspace";
import { composerKeyOf, NEW_SESSION_KEY } from "@/lib/composer-draft";
import { lastTurnPresentedPlan } from "@/lib/plan";
import type { SessionMode, ThinkingLevel } from "@/lib/types";

export default function App() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const { sessions, models, configured, activeId, activeSession, chat, workspaceRoot } = workspace;
  const { composer, setActiveId } = workspace;
  const interactions = useInteractions(activeId);

  // plan 模式本轮以 present_plan 收尾：用决策表单替掉输入区
  const planReady =
    activeSession?.mode === "plan" && !chat.streaming && lastTurnPresentedPlan(chat.items);

  const approvePlan = (): void => {
    if (!activeId) return;
    void (async () => {
      await sessions.setMode(activeId, "build");
      await chat.send(t("计划已批准"));
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
  const selectMode = (mode: SessionMode): void => {
    if (activeId) void sessions.setMode(activeId, mode);
    else composer.update(draftKey, { mode });
  };

  /** 新建会话 = 回到草稿态（输入框里没收尾的内容留着，见 lib/composer-draft），重选目录要重新挑 */
  const startNewSession = (): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, { cwd: undefined });
  };

  /** 「在目录中新建」：回到草稿态并把它绑到选中的目录，首条消息时才真建会话 */
  const startInDirectory = (path: string): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, { cwd: path });
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <SessionSidebar
          sessions={sessions.sessions}
          workspaceRoot={workspaceRoot}
          activeId={activeId}
          loading={sessions.loading}
          configured={configured}
          onSelect={setActiveId}
          onCreate={startNewSession}
          onCreateInDirectory={startInDirectory}
          onRename={(sessionId, name) => void sessions.rename(sessionId, name)}
          onDelete={(sessionId) => {
            void sessions.archive(sessionId);
            // 归档后这个会话的输入草稿也没有再恢复的意义
            composer.clear(composerKeyOf(sessionId));
          }}
          onOpenSettings={() => workspace.setSettingsOpen(true)}
        />

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
          planReady={planReady}
          onApprovePlan={approvePlan}
          onFeedbackPlan={(text) => void chat.send(text)}
        />

        <PermissionDialog
          request={interactions.pending[0] ?? null}
          onRespond={(requestId, decision) => void interactions.respond(requestId, decision)}
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
