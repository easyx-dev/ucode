/** 对话区：头部 + 错误提示 + 消息列表 + 输入框 */
import type { ReactNode } from "react";

import { ChatHeader } from "@/components/chat-header";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import type { ChatController } from "@/hooks/use-chat";
import type { ModelsResponse, SessionSummary, ThinkingLevel } from "@/lib/types";

type ChatPanelProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  modelsLoading: boolean;
  chat: ChatController;
  /** 没有消息时展示的内容 */
  empty: ReactNode;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onOpenSettings: () => void;
};

export function ChatPanel({
  session,
  models,
  modelsLoading,
  chat,
  empty,
  onReloadModels,
  onSelectModel,
  onSelectThinkingLevel,
  onOpenSettings,
}: ChatPanelProps) {
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <ChatHeader
        session={session}
        models={models}
        modelsLoading={modelsLoading}
        onReloadModels={onReloadModels}
        onSelectModel={onSelectModel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        onOpenSettings={onOpenSettings}
      />

      {chat.error ? (
        <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {chat.error}
        </div>
      ) : null}

      <MessageList items={chat.items} loading={chat.loadingHistory} empty={empty} />

      <Composer
        streaming={chat.streaming}
        disabled={!session}
        onSend={(text) => void chat.send(text)}
        onStop={() => void chat.stop()}
      />
    </main>
  );
}
