/** 对话区：头部 + 错误提示 + 消息列表 + 输入区（等用户决策时换成决策区） */
import { cn } from "cn";
import { Bot } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import type { ChatController } from "../hooks/use-chat";
import type { ComposerDraftsController } from "../hooks/use-composer-drafts";
import type { BuiltinCommandId } from "../lib/builtin-commands";
import { type ComposerNode, docToPayload, textToDoc } from "../lib/composer-document";
import { type ComposerDraft, composerKeyOf, emptyDraft } from "../lib/composer-draft";
import type { ComposerPayload } from "../lib/composer-payload";
import { type GoalCommand, parseGoalCommand } from "../lib/goal-command";
import { relativizeContextRefs } from "../lib/message-chips";
import { isWorkspaceSession } from "../lib/session-groups";
import {
  type ChatItem,
  type ContextUsage,
  DEFAULT_PERMISSION_MODE,
  type GoalView,
  type InteractionRespondRequest,
  type ModelsResponse,
  type PendingInteraction,
  type PermissionMode,
  type SessionCreateRequest,
  type SessionSummary,
  type ThinkingLevel,
  type UsageTotals,
} from "../lib/types";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";
import { DecisionArea } from "./decision-area";
import { DirectoryDialog } from "./directory-dialog";
import { GoalBar } from "./goal-bar";
import { MessageList } from "./message-list";
import { PermissionRequest } from "./permission-request";
import { PlanDecisionForm } from "./plan-decision-form";
import { QuestionRequest } from "./question-request";

/** 还没有任何消息时展示起步建议（含空态：直接打字就是第一个会话） */
const shouldShowSuggestions = (chat: ChatController): boolean =>
  !chat.loadingHistory && chat.items.length === 0;

type ChatPanelProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  /** 助理根目录（health.workspace）：判定会话的目录是不是我们分配的 */
  workspacesDir: string | null;
  chat: ChatController;
  /** 输入区草稿：按上下文持久化未发送的内容与初始设置 */
  composer: ComposerDraftsController;
  /** 没有会话时展示的内容 */
  empty: ReactNode;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onSelectMode: (mode: string) => void;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  onOpenSettings: () => void;
  /** 打开某个子会话（子智能体工具卡上的入口） */
  onOpenSession: (sessionId: string) => void;
  /** 展开 / 收起侧栏（移动端唤出抽屉） */
  onToggleSidebar?: () => void;
  /** 侧栏是否收起 */
  sidebarCollapsed?: boolean;
  /** 展开 / 收起工作台（右侧第三栏）；移动端唤出抽屉 */
  onToggleWorkbench?: () => void;
  /** 工作台是否展开 */
  workbenchOpen?: boolean;
  /** 新建任务（顶栏入口） */
  onNewTask?: () => void;
  /** 从某条消息分叉出新会话 */
  onFork: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话、非生成中可用） */
  onEdit: (item: ChatItem, text: string) => Promise<boolean>;
  /** 本会话分叉自的源会话名；用于头部来源链接 */
  forkedFromName?: string | null;
  /** 当前会话目标；用于输入区上方的目标栏 */
  goal?: GoalView | null;
  /** 处理 `/goal` 命令（设定 / 暂停 / 恢复 / 清除 / 查看） */
  onGoalCommand: (command: GoalCommand, seed?: SessionCreateRequest) => void;
  /** 执行内置命令（`/` 菜单里的动作型命令） */
  onBuiltin: (id: BuiltinCommandId) => void;
  /** 本会话累计 token 用量；用于头部徽标的显示条件 */
  usage?: UsageTotals | null;
  /** 本会话当前上下文占用；取不到时头部徽标只显示占位符 */
  context?: ContextUsage | null;
  /** 打开全局使用统计 */
  onOpenUsage?: () => void;
  /** 从子会话视图返回父会话 */
  onBackToParent?: () => void;
  /** 本会话待答的权限审批 / 提问；有值时决策区替掉输入区 */
  interaction: PendingInteraction | null;
  /** 回填一条答复（服务端按 kind 判别载荷） */
  onRespondInteraction: (input: InteractionRespondRequest) => void;
  /** plan 模式本轮以 present_plan 收尾：用决策表单替掉输入区 */
  planReady: boolean;
  onApprovePlan: () => void;
  onIgnorePlan: () => void;
  onFeedbackPlan: (text: string) => void;
};

export function ChatPanel({
  session,
  models,
  workspacesDir,
  chat,
  composer,
  empty,
  onReloadModels,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectMode,
  onSelectPermissionMode,
  onOpenSettings,
  onOpenSession,
  onToggleSidebar,
  sidebarCollapsed,
  onToggleWorkbench,
  workbenchOpen,
  onNewTask,
  onFork,
  onEdit,
  forkedFromName,
  goal,
  onGoalCommand,
  onBuiltin,
  usage,
  context,
  onOpenUsage,
  onBackToParent,
  interaction,
  onRespondInteraction,
  planReady,
  onApprovePlan,
  onIgnorePlan,
  onFeedbackPlan,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  /** 发送 / 编辑重发被受理后自增，交给消息列表把视口拉回最新一行 */
  const [sentTick, setSentTick] = useState(0);
  const draftKey = composerKeyOf(session?.id ?? null);
  const draft = composer.drafts[draftKey] ?? emptyDraft();

  /**
   * 草稿里的编辑器文档：优先用存下来的 doc；只有旧 `text` 的按单段落还原。
   * 切换会话 / 失败回填会让编辑器重挂载，因此这里作为「初始文档」传入。
   */
  const initialDoc: ComposerNode | undefined =
    (draft.doc as ComposerNode | undefined) ?? (draft.text ? textToDoc(draft.text) : undefined);

  /**
   * 发送：清空草稿（即时反馈 + 挡重复提交），把初始设置交给 useChat——还没有会话时先建会话；
   * 没发出去就把正文还回输入框（会话可能已经建好，按返回的会话 id 定位上下文）。
   * `/goal` 只在纯文本时才当命令解析，带引用 / 图片的消息按普通消息发。
   */
  const submit = useCallback(
    (payload: ComposerPayload) => {
      const seed = {
        cwd: draft.cwd,
        model: draft.model,
        thinkingLevel: draft.thinkingLevel,
        mode: draft.mode,
      };
      const isPlainText = payload.contexts.length === 0 && payload.attachments.length === 0;
      const command = isPlainText ? parseGoalCommand(payload.text) : null;
      if (command) {
        composer.clear(draftKey);
        onGoalCommand(command, seed);
        return;
      }
      composer.clear(draftKey);
      // 正文里的引用标记是编辑器插入的绝对路径，发送前换成相对工作目录的写法：
      // 句子读起来就是用户写的那句，且与展开块上的 `path` 同口径（编辑器只在有目录时可插引用）
      const sent = relativizeContextRefs(payload, session?.cwd ?? draft.cwd);
      void chat.send(sent, seed).then(({ sessionId: target, admitted }) => {
        // 受理即把视口交回最新一行；未受理（回填草稿）时不能动视口
        if (admitted) {
          setSentTick((tick) => tick + 1);
          return;
        }
        // 回填用换算前的载荷（标记是绝对路径），再次发送时重新换算
        const restored: Partial<ComposerDraft> = {
          text: payload.text,
          doc: textToDoc(payload.text),
          ...seed,
        };
        // 附件视图也还回输入框：字节已在服务端，草稿只存引用
        if (payload.attachments.length > 0) restored.attachments = payload.attachments;
        composer.update(composerKeyOf(target), restored);
      });
    },
    [chat, composer, draft, draftKey, onGoalCommand, session?.cwd],
  );

  /** 编辑重发与发送同一条路径：受理后同样要落回最新一行 */
  const handleEdit = useCallback(
    async (item: ChatItem, text: string): Promise<boolean> => {
      const accepted = await onEdit(item, text);
      if (accepted) setSentTick((tick) => tick + 1);
      return accepted;
    },
    [onEdit],
  );

  // 未绑定目录的会话不暴露 `workspace/<uuid>` 这串路径，直接标成「助理区」；
  // 空态显示草稿绑定的目录（「在目录中新建」选的）
  const inWorkspace = Boolean(
    session && workspacesDir && isWorkspaceSession(session.cwd, workspacesDir),
  );
  const cwd = session ? (inWorkspace ? t("助理区") : session.cwd) : (draft.cwd ?? t("助理区"));

  // 模型选择器只列已接入的供应商：目录里还有大量没配凭证的内置供应商，选了必然报错
  const providers = (models?.providers ?? []).filter((provider) => provider.available);
  /** 子会话由委派产生、只读查看，不提供输入区与 plan 决策表单 */
  const isChild = Boolean(session?.parentSessionId);
  /** 待答的审批 / 提问优先于计划决策：它正在阻塞工具调用，先答完才谈得上继续 */
  const showPlanForm = planReady && !isChild;
  /** 空对话时的起步建议，点击后填入输入框而不是直接发送 */
  const suggestions = [t("了解这个项目"), t("排查构建报错"), t("补充单元测试"), t("重构这段代码")];

  return (
    <main
      className={cn(
        "flex min-w-0 flex-1 flex-col overflow-hidden bg-card md:my-2 md:rounded-xl md:border md:border-border",
        // 工作台展开时这段间隙由分隔条充当，收起时卡片得自己留出来，否则右圆角会贴到窗口边缘
        workbenchOpen ? undefined : "md:mr-2",
      )}
    >
      <ChatHeader
        session={session}
        models={models}
        onReloadModels={onReloadModels}
        onOpenSettings={onOpenSettings}
        onToggleSidebar={onToggleSidebar}
        sidebarCollapsed={sidebarCollapsed}
        onToggleWorkbench={onToggleWorkbench}
        workbenchOpen={workbenchOpen}
        onNewTask={onNewTask}
        // 草稿阶段还没有目录可看
        onOpenDirectory={session ? () => setDirectoryOpen(true) : undefined}
        onBackToParent={onBackToParent}
        onOpenForkSource={onOpenSession}
        forkedFromName={forkedFromName}
        usage={usage}
        context={context}
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
        working={chat.streaming}
        compacting={chat.compacting}
        empty={empty}
        resetKey={session?.id ?? ""}
        sentTick={sentTick}
        onOpenSession={onOpenSession}
        onFork={isChild ? undefined : onFork}
        onEdit={isChild || chat.streaming ? undefined : handleEdit}
      />

      {!isChild && goal ? (
        <GoalBar goal={goal} onCommand={(command) => onGoalCommand(command)} />
      ) : null}

      {/* 输入区的位置按优先级让给决策：子会话只读，待答交互优先于计划决策 */}
      {isChild ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {t("子会话是委派产生的独立对话，只能查看；需要它继续请在父会话里说明。")}
          </p>
          <Button variant="outline" size="sm" onClick={onBackToParent}>
            {t("返回父会话")}
          </Button>
        </div>
      ) : interaction ? (
        <DecisionArea>
          {interaction.kind === "permission" ? (
            <PermissionRequest
              request={interaction}
              onRespond={(requestId, decision) =>
                onRespondInteraction({ requestId, kind: "permission", decision })
              }
            />
          ) : (
            <QuestionRequest
              request={interaction}
              onRespond={(requestId, answers) =>
                onRespondInteraction({ requestId, kind: "question", answers })
              }
            />
          )}
        </DecisionArea>
      ) : showPlanForm ? (
        <DecisionArea>
          <PlanDecisionForm
            onApprove={onApprovePlan}
            onIgnore={onIgnorePlan}
            onFeedback={onFeedbackPlan}
          />
        </DecisionArea>
      ) : (
        <Composer
          sessionId={session?.id ?? null}
          cwd={cwd}
          cwdPath={session?.cwd ?? draft.cwd}
          initialDoc={initialDoc}
          initialAttachments={draft.attachments}
          editorKey={draftKey}
          onDocChange={(doc) => composer.update(draftKey, { doc, text: docToPayload(doc).text })}
          onAttachmentsChange={(attachments) => composer.update(draftKey, { attachments })}
          onSend={submit}
          streaming={chat.streaming}
          onStop={() => void chat.stop()}
          suggestions={shouldShowSuggestions(chat) ? suggestions : undefined}
          providers={providers}
          model={session?.model ?? draft.model ?? models?.defaultModel ?? ""}
          thinkingLevel={
            session?.thinkingLevel ?? draft.thinkingLevel ?? models?.thinkingLevel ?? "off"
          }
          mode={session?.mode ?? draft.mode ?? "build"}
          permissionMode={session?.permissionMode ?? DEFAULT_PERMISSION_MODE}
          onSelectModel={onSelectModel}
          onSelectThinkingLevel={onSelectThinkingLevel}
          onSelectMode={onSelectMode}
          onSelectPermissionMode={onSelectPermissionMode}
          onBuiltin={onBuiltin}
        />
      )}
    </main>
  );
}
