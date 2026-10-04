/** 应用的组合根：把会话、模型、输入区草稿、当前会话与消息流接在一起 */
import { useMemo, useState } from "react";
import { hasDraftContent, NEW_SESSION_KEY } from "../lib/composer-draft";
import { useActiveSession } from "./use-active-session";
import { useChat } from "./use-chat";
import { useComposerDrafts } from "./use-composer-drafts";
import { useHealth } from "./use-health";
import { useModels } from "./use-models";
import { useSessions } from "./use-sessions";

export function useWorkspace() {
  const sessions = useSessions();
  const models = useModels();
  const health = useHealth();
  const composer = useComposerDrafts();
  // 输入框里还有没发出去的草稿时不被自动带进别的会话
  const pendingDraft = hasDraftContent(composer.drafts[NEW_SESSION_KEY]);
  const {
    activeId,
    setActiveId,
    session: activeSessionBase,
  } = useActiveSession(sessions.sessions, sessions.loading, pendingDraft);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const configured = models.data?.configured ?? false;
  const chat = useChat(activeId, {
    onSettled: () => {
      void sessions.refresh();
    },
    // 首发消息时服务端建好了会话，把它设为当前会话，事件流随即接上
    onSessionCreated: setActiveId,
    createSession: (seed) => sessions.create(seed),
  });

  // 本页正在生成时无需等服务端刷新，列表项就能显示运行态
  const sessionsView = useMemo(
    () =>
      sessions.sessions.map((session) =>
        session.id === activeId && chat.streaming ? { ...session, running: true } : session,
      ),
    [activeId, chat.streaming, sessions.sessions],
  );
  const activeSession = useMemo(
    () =>
      activeSessionBase && activeSessionBase.id === activeId && chat.streaming
        ? { ...activeSessionBase, running: true }
        : activeSessionBase,
    [activeId, activeSessionBase, chat.streaming],
  );

  const handleSettingsSaved = () => {
    void models.reload();
    void sessions.refresh();
  };

  return {
    sessions: { ...sessions, sessions: sessionsView },
    models,
    configured,
    /** 助理根目录（health 未就绪时为 null） */
    workspaceRoot: health?.workspace ?? null,
    activeId,
    setActiveId,
    activeSession,
    composer,
    chat,
    settingsOpen,
    setSettingsOpen,
    handleSettingsSaved,
  };
}
