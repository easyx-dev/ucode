import { useEffect, useState } from "react";

import { ChatHeader } from "@/components/chat-header";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { SessionSidebar } from "@/components/session-sidebar";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChat } from "@/hooks/use-chat";
import { useModels } from "@/hooks/use-models";
import { useSessions } from "@/hooks/use-sessions";
import type { ThinkingLevel } from "@/lib/types";

export default function App() {
  const sessionsApi = useSessions();
  const models = useModels();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeSession = sessionsApi.sessions.find((item) => item.id === activeId) ?? null;
  const configured = models.data?.configured ?? false;

  const chat = useChat(activeId, () => {
    void sessionsApi.refresh();
  });

  // 首次自动选中最近会话
  useEffect(() => {
    if (activeId !== null) return;
    const first = sessionsApi.sessions[0];
    if (first) setActiveId(first.id);
  }, [activeId, sessionsApi.sessions]);

  // 会话被删除后清空选择
  useEffect(() => {
    if (activeId && !sessionsApi.sessions.some((item) => item.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, sessionsApi.sessions]);

  const handleCreate = async () => {
    const session = await sessionsApi.create();
    if (session) setActiveId(session.id);
    else if (!configured) setSettingsOpen(true);
  };

  const handleSaved = () => {
    void models.reload();
    void sessionsApi.refresh();
  };

  const emptyState = !configured ? (
    <Card className="mx-auto max-w-lg border-dashed">
      <CardHeader>
        <CardTitle className="text-base">还没有配置模型</CardTitle>
        <CardDescription>
          填入一个 OpenAI 兼容端点（baseUrl / apiKey / 模型 id）后即可开始对话。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => setSettingsOpen(true)}>打开模型设置</Button>
      </CardContent>
    </Card>
  ) : sessionsApi.sessions.length === 0 ? (
    <Card className="mx-auto max-w-lg border-dashed">
      <CardHeader>
        <CardTitle className="text-base">开始第一个会话</CardTitle>
        <CardDescription>
          模型已就绪：{models.data?.defaultModel ?? "-"}。会话里的 agent 可以读写
          <code className="mx-1 rounded bg-muted px-1">.tmp/.ucode</code>
          下的文件并执行命令。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => void handleCreate()}>新建会话</Button>
      </CardContent>
    </Card>
  ) : (
    <div className="mx-auto max-w-lg space-y-2 text-center text-sm text-muted-foreground">
      <p>选择左侧会话，或新建一个会话开始对话。</p>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <SessionSidebar
          sessions={sessionsApi.sessions}
          activeId={activeId}
          loading={sessionsApi.loading}
          configured={configured}
          onSelect={setActiveId}
          onCreate={() => void handleCreate()}
          onRename={(sessionId, name) => void sessionsApi.rename(sessionId, name)}
          onDelete={(sessionId) => void sessionsApi.remove(sessionId)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <ChatHeader
            session={activeSession}
            models={models.data}
            modelsLoading={models.loading}
            onReloadModels={() => void models.refresh()}
            onSelectModel={(model) => {
              if (activeId) void sessionsApi.setModel(activeId, model);
            }}
            onSelectThinkingLevel={(level: ThinkingLevel) => {
              if (activeId) void sessionsApi.setThinkingLevel(activeId, level);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          {chat.error ? (
            <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
              {chat.error}
            </div>
          ) : null}

          <MessageList items={chat.items} loading={chat.loadingHistory} empty={emptyState} />

          <Composer
            streaming={chat.streaming}
            disabled={!activeId}
            onSend={(text) => void chat.send(text)}
            onStop={() => void chat.stop()}
          />
        </main>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={handleSaved} />
        <Toaster position="top-center" />
      </div>
    </TooltipProvider>
  );
}
