/** 应用外壳：会话侧栏 + 对话区 + 设置对话框 */
import { ChatPanel } from "@/components/chat-panel";
import { SessionSidebar } from "@/components/session-sidebar";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomePanel } from "@/components/welcome-panel";
import { useWorkspace } from "@/hooks/use-workspace";

export default function App() {
  const workspace = useWorkspace();
  const { sessions, models, configured, activeId, activeSession, chat } = workspace;

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
          onOpenSettings={() => workspace.setSettingsOpen(true)}
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
