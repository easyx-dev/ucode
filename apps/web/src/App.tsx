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
import { lastTurnPresentedPlan } from "@/lib/plan";

export default function App() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const { sessions, models, configured, activeId, activeSession, chat } = workspace;
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

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <SessionSidebar
          sessions={sessions.sessions}
          projects={workspace.projects.projects}
          activeId={activeId}
          loading={sessions.loading}
          configured={configured}
          onSelect={workspace.setActiveId}
          onCreate={(cwd) => void workspace.createSession(cwd)}
          onRename={(sessionId, name) => void sessions.rename(sessionId, name)}
          onDelete={(sessionId) => void sessions.remove(sessionId)}
          onAddProject={(path) => void workspace.projects.add(path)}
          onRenameProject={(projectId, name) => void workspace.projects.rename(projectId, name)}
          onDeleteProject={(projectId) => void workspace.projects.remove(projectId)}
          onOpenSettings={() => workspace.setSettingsOpen(true)}
        />

        <ChatPanel
          session={activeSession}
          models={models.data}
          chat={chat}
          empty={
            <WelcomePanel
              configured={configured}
              defaultModel={models.data?.defaultModel ?? null}
              hasSessions={sessions.sessions.length > 0}
              workspace={workspace.workspaceDir}
              onCreate={() => void workspace.createSession()}
              onOpenSettings={() => workspace.setSettingsOpen(true)}
            />
          }
          onReloadModels={() => void models.refresh()}
          onSelectModel={(model) => {
            if (activeId) void sessions.setModel(activeId, model);
          }}
          onSelectThinkingLevel={(level) => {
            if (activeId) void sessions.setThinkingLevel(activeId, level);
          }}
          onSelectMode={(mode) => {
            if (activeId) void sessions.setMode(activeId, mode);
          }}
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
