/** 应用的组合根：把会话、模型、当前会话与消息流接在一起 */
import { useMemo, useState } from "react";

import { useActiveSession } from "@/hooks/use-active-session";
import { useChat } from "@/hooks/use-chat";
import { useHealth } from "@/hooks/use-health";
import { useModels } from "@/hooks/use-models";
import { useSessions } from "@/hooks/use-sessions";

export function useWorkspace() {
  const sessions = useSessions();
  const models = useModels();
  const health = useHealth();
  const { activeId, setActiveId } = useActiveSession(sessions.sessions, sessions.loading);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const configured = models.data?.configured ?? false;
  const chat = useChat(activeId, () => {
    void sessions.refresh();
  });

  // 本页正在生成时无需等服务端刷新，列表项就能显示运行态
  const sessionsView = useMemo(
    () =>
      sessions.sessions.map((session) =>
        session.id === activeId && chat.streaming ? { ...session, running: true } : session,
      ),
    [activeId, chat.streaming, sessions.sessions],
  );
  const activeSession = sessionsView.find((item) => item.id === activeId) ?? null;

  const createSession = async () => {
    const session = await sessions.create();
    if (session) setActiveId(session.id);
    else if (!configured) setSettingsOpen(true);
  };

  const handleSettingsSaved = () => {
    void models.reload();
    void sessions.refresh();
  };

  return {
    sessions: { ...sessions, sessions: sessionsView },
    models,
    configured,
    /** agent 工作目录（health 未就绪时为 null） */
    workspaceDir: health?.workspace ?? null,
    activeId,
    setActiveId,
    activeSession,
    chat,
    settingsOpen,
    setSettingsOpen,
    createSession,
    handleSettingsSaved,
  };
}
