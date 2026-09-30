/** 对话区：头部 + 错误提示 + 消息列表 + 输入区 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ChatHeader } from "@/components/chat-header";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import type { ChatController } from "@/hooks/use-chat";
import type { ModelsResponse, SessionMode, SessionSummary, ThinkingLevel } from "@/lib/types";

/** 只有「已选会话且历史加载完、没有任何消息」才展示起步建议 */
const showSuggestions = (session: SessionSummary | null, chat: ChatController): boolean =>
  Boolean(session) && !chat.loadingHistory && chat.items.length === 0;

type ChatPanelProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  chat: ChatController;
  /** 没有消息时展示的内容 */
  empty: ReactNode;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onSelectMode: (mode: SessionMode) => void;
  onOpenSettings: () => void;
};

export function ChatPanel({
  session,
  models,
  chat,
  empty,
  onReloadModels,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectMode,
  onOpenSettings,
}: ChatPanelProps) {
  const { t } = useTranslation();
  // 模型选择器只列已接入的供应商：目录里还有大量没配凭证的内置供应商，选了必然报错
  const providers = (models?.providers ?? []).filter((provider) => provider.available);
  /** 空对话时的起步建议，点击后填入输入框而不是直接发送 */
  const suggestions = [t("了解这个项目"), t("排查构建报错"), t("补充单元测试"), t("重构这段代码")];

  return (
    <main className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <ChatHeader
        session={session}
        models={models}
        onReloadModels={onReloadModels}
        onOpenSettings={onOpenSettings}
      />

      {chat.error ? (
        <div className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {chat.error}
        </div>
      ) : null}

      <MessageList
        items={chat.items}
        loading={chat.loadingHistory}
        pending={chat.pending}
        empty={empty}
      />

      <Composer
        streaming={chat.streaming}
        disabled={!session}
        onSend={(text) => void chat.send(text)}
        onStop={() => void chat.stop()}
        suggestions={showSuggestions(session, chat) ? suggestions : undefined}
        cwd={session?.cwd}
        providers={providers}
        model={session?.model ?? models?.defaultModel ?? ""}
        thinkingLevel={session?.thinkingLevel ?? models?.thinkingLevel ?? "off"}
        mode={session?.mode ?? "build"}
        onSelectModel={onSelectModel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        onSelectMode={onSelectMode}
      />
    </main>
  );
}
