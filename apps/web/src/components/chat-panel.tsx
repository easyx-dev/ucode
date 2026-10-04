/** 对话区：头部 + 错误提示 + 消息列表 + 输入区 */
import { Bot } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChatHeader } from "@/components/chat-header";
import { Composer } from "@/components/composer";
import { DirectoryDialog } from "@/components/directory-dialog";
import { GoalBar } from "@/components/goal-bar";
import { MessageList } from "@/components/message-list";
import { PlanDecisionForm } from "@/components/plan-decision-form";
import { Button } from "@/components/ui/button";
import type { ChatController } from "@/hooks/use-chat";
import type { ComposerDraftsController } from "@/hooks/use-composer-drafts";
import type { SessionSeed } from "@/hooks/use-send-message";
import { composerKeyOf, emptyDraft } from "@/lib/composer-draft";
import { type GoalCommand, parseGoalCommand } from "@/lib/goal-command";
import { isWorkspaceSession } from "@/lib/session-groups";
import type {
  ChatItem,
  GoalView,
  ModelsResponse,
  SessionMode,
  SessionSummary,
  ThinkingLevel,
  UsageTotals,
} from "@/lib/types";

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
  /** 打开某个子会话（子智能体工具卡上的入口） */
  onOpenSession: (sessionId: string) => void;
  /** 从某条消息分叉出新会话 */
  onFork: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话、非生成中可用） */
  onEdit: (item: ChatItem, text: string) => Promise<boolean>;
  /** 本会话分叉自的源会话名；用于头部来源链接 */
  forkedFromName?: string | null;
  /** 当前会话目标；用于输入区上方的目标栏 */
  goal?: GoalView | null;
  /** 处理 `/goal` 命令（设定 / 暂停 / 恢复 / 清除 / 查看） */
  onGoalCommand: (command: GoalCommand, seed?: SessionSeed) => void;
  /** 本会话累计 token 用量；用于头部徽标 */
  usage?: UsageTotals | null;
  /** 打开全局使用统计 */
  onOpenUsage?: () => void;
  /** 从子会话视图返回父会话 */
  onBackToParent?: () => void;
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
  onOpenSession,
  onFork,
  onEdit,
  forkedFromName,
  goal,
  onGoalCommand,
  usage,
  onOpenUsage,
  onBackToParent,
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
    // 以 `/goal` 开头的是目标命令，不进普通消息流
    const command = parseGoalCommand(text);
    if (command) {
      composer.clear(draftKey);
      onGoalCommand(command, seed);
      return;
    }
    composer.clear(draftKey);
    void chat.send(text, seed).then(({ sessionId: target, admitted }) => {
      if (!admitted) composer.update(composerKeyOf(target), { text, ...seed });
    });
  }, [chat, composer, draft, draftKey, onGoalCommand]);

  // 未绑定目录的会话不暴露 `workspace/<uuid>` 这串路径，直接标成「助理区」；
  // 空态显示草稿绑定的目录（「在目录中新建」选的）
  const inWorkspace = Boolean(
    session && workspaceRoot && isWorkspaceSession(session.cwd, workspaceRoot),
  );
  const cwd = session ? (inWorkspace ? t("助理区") : session.cwd) : (draft.cwd ?? t("助理区"));

  // 模型选择器只列已接入的供应商：目录里还有大量没配凭证的内置供应商，选了必然报错
  const providers = (models?.providers ?? []).filter((provider) => provider.available);
  /** 子会话由委派产生、只读查看，不提供输入区与 plan 决策表单 */
  const isChild = Boolean(session?.parentSessionId);
  const showPlanForm = planReady && !isChild;
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
        onBackToParent={onBackToParent}
        onOpenForkSource={onOpenSession}
        forkedFromName={forkedFromName}
        usage={usage}
        onOpenUsage={onOpenUsage}
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
        onOpenSession={onOpenSession}
        onFork={isChild ? undefined : onFork}
        onEdit={isChild || chat.streaming ? undefined : onEdit}
      />

      {!isChild && goal ? (
        <GoalBar goal={goal} onCommand={(command) => onGoalCommand(command)} />
      ) : null}

      {isChild ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("子会话.只读提示")}</p>
          <Button variant="outline" size="sm" onClick={onBackToParent}>
            {t("返回父会话")}
          </Button>
        </div>
      ) : showPlanForm ? (
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
