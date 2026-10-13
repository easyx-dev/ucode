/**
 * 内置命令（`/` 菜单第一组）：执行界面动作，不进消息流。
 */

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BUILTIN_COMMANDS, type BuiltinCommandId } from "../../business/composer/builtin-commands";
import { textToDoc } from "../../business/composer/document/composer-document";
import { composerKeyOf } from "../../business/composer/document/composer-draft";
import type { useComposerDrafts } from "../../business/composer/use-composer-drafts";
import type { useChat } from "../../hooks/store/use-chat";
import type { useSessions } from "../../hooks/store/use-sessions";
import type { useActiveSession } from "../../hooks/use-active-session";
import type { SessionSummary } from "../../types";

export function useBuiltinCommands({
  activeId,
  session,
  chat,
  composer,
  sessions,
  setActiveId,
  startNewSession,
  requestRename,
  forkCurrent,
  openSettings,
}: {
  activeId: string | null;
  session: ReturnType<typeof useActiveSession>;
  chat: ReturnType<typeof useChat>;
  composer: ReturnType<typeof useComposerDrafts>;
  sessions: ReturnType<typeof useSessions>;
  setActiveId: (sessionId: string | null) => void;
  startNewSession: () => void;
  requestRename: (session: SessionSummary) => void;
  forkCurrent: () => void;
  openSettings: () => void;
}): (id: BuiltinCommandId) => void {
  const { t } = useTranslation();

  return (id: BuiltinCommandId): void => {
    switch (id) {
      case "new":
        startNewSession();
        break;
      case "rename":
        if (session) requestRename(session);
        break;
      case "archive": {
        if (!activeId) return;
        const archived = activeId;
        void sessions.archive(archived);
        composer.clear(composerKeyOf(archived));
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
}
