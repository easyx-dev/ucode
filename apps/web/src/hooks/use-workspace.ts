/** 应用的组合根：把会话、模型、当前会话与消息流接在一起 */
import { useState } from "react";

import { useActiveSession } from "@/hooks/use-active-session";
import { useChat } from "@/hooks/use-chat";
import { useModels } from "@/hooks/use-models";
import { useSessions } from "@/hooks/use-sessions";

export function useWorkspace() {
  const sessions = useSessions();
  const models = useModels();
  const { activeId, setActiveId } = useActiveSession(sessions.sessions);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const configured = models.data?.configured ?? false;
  const activeSession = sessions.sessions.find((item) => item.id === activeId) ?? null;
  const chat = useChat(activeId, () => {
    void sessions.refresh();
  });

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
    sessions,
    models,
    configured,
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
