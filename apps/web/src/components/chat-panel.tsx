/** 对话区：头部 + 错误提示 + 消息列表 + 输入区 */
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChatHeader } from "@/components/chat-header";
import { Composer } from "@/components/composer";
import { DirectoryDialog } from "@/components/directory-dialog";
import { MessageList } from "@/components/message-list";
import { PlanDecisionForm } from "@/components/plan-decision-form";
import type { ChatController } from "@/hooks/use-chat";
import type { ComposerDraftsController } from "@/hooks/use-composer-drafts";
import { composerKeyOf, emptyDraft } from "@/lib/composer-draft";
import { isWorkspaceSession } from "@/lib/session-groups";
import type { ModelsResponse, SessionMode, SessionSummary, ThinkingLevel } from "@/lib/types";

/** 还没有任何消息时展示起步建议（含空态：直接打字就是第一个会话） */
const showSuggestions = (chat: ChatController): boolean =>
  !chat.loadingHistory && chat.items.length === 0;

type ChatPanelProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  /** 助理根目录（health.workspace）：判定会话的目录是不是我们分配的 */
  workspaceRoot: string | null;
  chat: ChatController;
  /** 输入区草稿：按上下文持久化未发送的内容与初始设置 */
  composer: ComposerDraftsController;
  /** 没有会话时展示的内容 */
  empty: ReactNode;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onSelectMode: (mode: SessionMode) => void;
  onOpenSettings: () => void;
  /** plan 模式本轮以 present_plan 收尾：用决策表单替掉输入区 */
  planReady: boolean;
  onApprovePlan: () => void;
  onFeedbackPlan: (text: string) => void;
};

export function ChatPanel({
  session,
  models,
  workspaceRoot,
  chat,
  composer,
  empty,
  onReloadModels,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectMode,
  onOpenSettings,
  planReady,
  onApprovePlan,
  onFeedbackPlan,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const draftKey = composerKeyOf(session?.id ?? null);
  const draft = composer.drafts[draftKey] ?? emptyDraft();

  /**
   * 发送：立即清空输入框（既是对发送的即时反馈，也挡住连按两次重复提交），
   * 把草稿里的初始设置交给 useChat——还没有会话时它会先建会话，`seed` 就是新会话的初始设置；
   * 没发出去就把原文还回输入框（会话可能已经建好，所以按返回的会话 id 定位上下文），别让用户重打。
   */
  const submit = useCallback(() => {
    const text = draft.text.trim();
    if (!text) return;
    const seed = {
      cwd: draft.cwd,
      model: draft.model,
      thinkingLevel: draft.thinkingLevel,
      mode: draft.mode,
    };
    composer.clear(draftKey);
    void chat.send(text, seed).then(({ sessionId: target, admitted }) => {
      if (!admitted) composer.update(composerKeyOf(target), { text, ...seed });
    });
  }, [chat, composer, draft, draftKey]);

  // 未绑定目录的会话不暴露 `workspace/<uuid>` 这串路径，直接标成「助理区」；
  // 空态显示草稿绑定的目录（「在目录中新建」选的）
  const inWorkspace = Boolean(
    session && workspaceRoot && isWorkspaceSession(session.cwd, workspaceRoot),
  );
  const cwd = session ? (inWorkspace ? t("助理区") : session.cwd) : (draft.cwd ?? t("助理区"));

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
        // 草稿阶段还没有目录可看
        onOpenDirectory={session ? () => setDirectoryOpen(true) : undefined}
      />

      <DirectoryDialog
        open={directoryOpen}
        onOpenChange={setDirectoryOpen}
        path={session?.cwd ?? null}
      />

      {chat.error ? (
        <div className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {chat.error}
        </div>
      ) : null}

      <MessageList
        items={chat.items}
        subagents={chat.subagents}
        loading={chat.loadingHistory}
        pending={chat.pending}
        empty={empty}
      />

      {planReady ? (
        <PlanDecisionForm onApprove={onApprovePlan} onFeedback={onFeedbackPlan} />
      ) : (
        <Composer
          value={draft.text}
          onChange={(text) => composer.update(draftKey, { text })}
          onSend={submit}
          streaming={chat.streaming}
          onStop={() => void chat.stop()}
          suggestions={showSuggestions(chat) ? suggestions : undefined}
          cwd={cwd}
          providers={providers}
          model={session?.model ?? draft.model ?? models?.defaultModel ?? ""}
          thinkingLevel={
            session?.thinkingLevel ?? draft.thinkingLevel ?? models?.thinkingLevel ?? "off"
          }
          mode={session?.mode ?? draft.mode ?? "build"}
          onSelectModel={onSelectModel}
          onSelectThinkingLevel={onSelectThinkingLevel}
          onSelectMode={onSelectMode}
        />
      )}
    </main>
  );
}
