/** 对话区头部：会话标题 + 操作区 + 工作目录 */
import { ChatHeaderActions } from "@/components/chat-header-actions";
import { SessionCwd } from "@/components/session-cwd";
import { Skeleton } from "@/components/ui/skeleton";
import { sessionTitle } from "@/lib/session";
import type { ModelsResponse, SessionSummary, ThinkingLevel } from "@/lib/types";

type ChatHeaderProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  modelsLoading: boolean;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onOpenSettings: () => void;
};

export function ChatHeader({
  session,
  models,
  modelsLoading,
  onReloadModels,
  onSelectModel,
  onSelectThinkingLevel,
  onOpenSettings,
}: ChatHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {session ? sessionTitle(session) : "未选择会话"}
        </div>
      </div>

      {modelsLoading ? <Skeleton className="ml-auto h-8 w-40" /> : null}

      {!modelsLoading ? (
        <ChatHeaderActions
          session={session}
          models={models}
          onReloadModels={onReloadModels}
          onSelectModel={onSelectModel}
          onSelectThinkingLevel={onSelectThinkingLevel}
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {session ? <SessionCwd cwd={session.cwd} /> : null}
    </header>
  );
}
