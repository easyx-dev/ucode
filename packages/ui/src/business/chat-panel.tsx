/** 对话区：头部 + 错误提示 + 消息列表 + 输入区（等用户决策时换成决策区） */
import { cn } from "cn";
import { Bot } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import type { ChatController } from "../hooks/use-chat";
import type { ComposerDraftsController } from "../hooks/use-composer-drafts";
import { useProjects } from "../hooks/use-projects";
import type { BuiltinCommandId } from "../lib/builtin-commands";
import { type ComposerNode, docToPayload, textToDoc } from "../lib/composer-document";
import { composerKeyOf, emptyDraft } from "../lib/composer-draft";
import type { ComposerPayload } from "../lib/composer-payload";
import { type GoalCommand, parseGoalCommand } from "../lib/goal-command";
import { buildGoalTurns } from "../lib/goal-turns";
import { relativizeContextRefs } from "../lib/message-chips";
import { draftSeedOf, projectLabel, projectOf } from "../lib/project";
import { isWorkspaceSession } from "../lib/session-groups";
import {
  type ChatItem,
  type ContextUsage,
  DEFAULT_PERMISSION_MODE,
  type EditMessagePayload,
  type GoalView,
  type InteractionRespondRequest,
  type ModelsResponse,
  type PendingInteraction,
  type PermissionMode,
  type SessionCreateRequest,
  type SessionSummary,
  type ThinkingPreference,
  type UsageTotals,
} from "../lib/types";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";
import { DecisionPanel } from "./decision-panel";
import { GoalBar } from "./goal-bar";
import { MessageList } from "./message-list";
import { PermissionRequest } from "./permission-request";
import { PlanDecisionForm } from "./plan-decision-form";
import { QuestionRequest } from "./question-request";
import { openSubagentSessionDialog } from "./subagent-session-dialog";
import { WelcomePanel } from "./welcome-panel";

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
  /** 还没配置模型：空态改成提示与设置入口，其余界面照常 */
  configured: boolean;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingPreference) => void;
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
  /** 双击标题就地改名（新名称弹层由上层管） */
  onRenameSession?: () => void;
  /** 从某条消息分叉出新会话 */
  onFork: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话、非生成中可用） */
  onEdit: (item: ChatItem, payload: EditMessagePayload) => Promise<boolean>;
  /** 本会话分叉自的源会话名；用于头部来源链接 */
  forkedFromName?: string | null;
  /** 当前会话目标；用于输入区上方的目标栏 */
  goal?: GoalView | null;
  /** 处理 `/goal` 命令（设定 / 暂停 / 恢复 / 清除 / 查看） */
  onGoalCommand: (command: GoalCommand, seed?: SessionCreateRequest) => void;
  /** 改写目标预算（null 表示不限）；由目标栏的内联编辑提交 */
  onGoalBudget: (tokenBudget: number | null) => void;
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
  configured,
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
  onRenameSession,
  onFork,
  onEdit,
  forkedFromName,
  goal,
  onGoalCommand,
  onGoalBudget,
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
  /** 发送 / 编辑重发被受理后自增，交给消息列表把视口拉回最新一行 */
  const [sentTick, setSentTick] = useState(0);
  // 目标栏的逐轮列表与消息区的「目标续跑」分隔行同源；只保留本次目标开始之后的轮次
  // （同一会话换过目标时，前一个目标的轮次不该算在现目标头上），并按条目算一次
  const goalTurns = useMemo(() => {
    const all = buildGoalTurns(chat.items).turns;
    if (!goal) return all;
    return all.filter((turn) => turn.at === undefined || turn.at >= goal.startedAt);
  }, [chat.items, goal]);
  // 子智能体工具卡的入口直接开详情小窗（弹层自己管开关），保持引用稳定以免作废消息行的记忆化
  const openSubagent = useCallback((sessionId: string): void => {
    void openSubagentSessionDialog(sessionId);
  }, []);
  const projects = useProjects();
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
   * 没发出去就把那份文档（引用与附件都在节点里）还回输入框
   * （会话可能已经建好，按返回的会话 id 定位上下文）。
   * `/goal` 只在纯文本时才当命令解析，带引用 / 图片的消息按普通消息发。
   */
  const submit = useCallback(
    (payload: ComposerPayload, doc: ComposerNode) => {
      const seed = {
        cwd: draft.cwd,
        model: draft.model,
        thinkingLevel: draft.thinkingLevel,
        mode: draft.mode,
        // 由项目继承而来（空态没有改动入口）；随建会话落成初始档位
        permissionMode: draft.permissionMode,
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
        // 回填原样用发送时那份文档：附件节点与引用都在里面，再次发送时重新换算标记
        composer.update(composerKeyOf(target), {
          doc,
          text: docToPayload(doc).text,
          ...seed,
        });
      });
    },
    [chat, composer, draft, draftKey, onGoalCommand, session?.cwd],
  );

  /** 编辑重发与发送同一条路径：受理后同样要落回最新一行 */
  const handleEdit = useCallback(
    async (item: ChatItem, payload: EditMessagePayload): Promise<boolean> => {
      const accepted = await onEdit(item, payload);
      if (accepted) setSentTick((tick) => tick + 1);
      return accepted;
    },
    [onEdit],
  );

  // 未绑定目录的会话不暴露 `workspace/<uuid>` 这串路径，直接标成「助理区」
  const inWorkspace = Boolean(
    session && workspacesDir && isWorkspaceSession(session.cwd, workspacesDir),
  );
  /**
   * 项目条要的展示名与路径：助理区（含还没选目录的草稿）没有项目行，草稿态没选目录时显示「小助理」。
   * 展示名走项目登记表，用户在侧栏改过的名字在这里跟着变。
   */
  const projectPath = session ? (inWorkspace ? null : session.cwd) : (draft.cwd ?? null);
  const projectName = projectPath
    ? projectLabel(projectPath, projectOf(projects.projects, projectPath))
    : t("小助理");

  // 模型选择器只列已接入的供应商：目录里还有大量没配凭证的内置供应商，选了必然报错
  const providers = (models?.providers ?? []).filter((provider) => provider.available);
  /** 子会话由委派产生、只读查看，不提供输入区与 plan 决策表单 */
  const isChild = Boolean(session?.parentSessionId);
  /** 空态：还没有任何消息（不在生成、也不是子会话）——输入卡居中，问候在它上方 */
  const hero = shouldShowSuggestions(chat) && !chat.streaming && !isChild;
  /** 待答的审批 / 提问优先于计划决策：它正在阻塞工具调用，先答完才谈得上继续 */
  const showPlanForm = planReady && !isChild;

  /** 盖在输入区上的决策面板：待答交互优先，其次才是计划决策；子会话只读、没有决策 */
  const decision = isChild ? null : interaction ? (
    interaction.kind === "permission" ? (
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
    )
  ) : showPlanForm ? (
    <PlanDecisionForm
      onApprove={onApprovePlan}
      onIgnore={onIgnorePlan}
      onFeedback={onFeedbackPlan}
    />
  ) : null;

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
        onRenameSession={onRenameSession}
        onBackToParent={onBackToParent}
        onOpenForkSource={onOpenSession}
        forkedFromName={forkedFromName}
        usage={usage}
        context={context}
        onOpenUsage={onOpenUsage}
      />

      {chat.error ? (
        <div className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {chat.error}
        </div>
      ) : null}

      {hero ? null : (
        <MessageList
          items={chat.items}
          subagents={chat.subagents}
          loading={chat.loadingHistory}
          working={chat.streaming}
          compacting={chat.compacting}
          resetKey={session?.id ?? ""}
          sentTick={sentTick}
          onOpenSession={openSubagent}
          onFork={isChild ? undefined : onFork}
          onEdit={isChild || chat.streaming ? undefined : handleEdit}
        />
      )}

      {/* 完成后收起状态条：目标在哪儿结束由对话里的「目标完成」细线负责，条不再常驻 */}
      {!isChild && goal && goal.status !== "completed" ? (
        <GoalBar
          goal={goal}
          turns={goalTurns}
          onCommand={(command) => onGoalCommand(command)}
          onBudget={onGoalBudget}
        />
      ) : null}

      {/* 输入区照常留在原位，等用户作答时由决策面板盖住它（待答交互优先于计划决策）；子会话只读，连同输入区一起收起 */}
      {isChild ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Bot className="size-icon-base shrink-0 text-foreground-subtle" />
          <p className="min-w-0 flex-1 text-xs text-foreground-subtle">
            {t("子会话是委派产生的独立对话，只能查看；需要它继续请在父会话里说明。")}
          </p>
          <Button variant="outline" size="sm" onClick={onBackToParent}>
            {t("返回父会话")}
          </Button>
        </div>
      ) : (
        // 决策面板要盖住输入区，两者得在同一个定位上下文里
        <div className={cn("relative", hero && "flex min-h-0 flex-1 flex-col justify-center")}>
          {/* 光盖住不够：焦点/键盘也得进不去，否则看不见的输入框照样收字符 */}
          <div inert={Boolean(decision)}>
            {hero ? <WelcomePanel configured={configured} onOpenSettings={onOpenSettings} /> : null}
            <Composer
              sessionId={session?.id ?? null}
              cwdPath={session?.cwd ?? draft.cwd}
              initialDoc={initialDoc}
              editorKey={draftKey}
              onDocChange={(doc) =>
                composer.update(draftKey, { doc, text: docToPayload(doc).text })
              }
              onSend={submit}
              streaming={chat.streaming}
              onStop={() => void chat.stop()}
              showSuggestions={shouldShowSuggestions(chat)}
              projectName={projectName}
              projectPath={projectPath}
              // 换项目要走草稿种子：只改 cwd 会把上一个项目的模型与权限档位留下来
              onSelectProject={(path) =>
                composer.update(draftKey, draftSeedOf(projects.projects, path ?? undefined))
              }
              providers={providers}
              model={session?.model ?? draft.model ?? models?.defaultModel ?? ""}
              thinkingLevel={session?.thinkingLevel ?? draft.thinkingLevel ?? "auto"}
              // 空态不知道模式的推荐档位，此时只显示「自动」；拿到会话摘要后才有实际档位
              resolvedThinkingLevel={session?.resolvedThinkingLevel}
              mode={session?.mode ?? draft.mode ?? "build"}
              // 档位在空态由项目继承（选择器禁用，改不了）；没有项目行时为默认档
              permissionMode={
                session?.permissionMode ?? draft.permissionMode ?? DEFAULT_PERMISSION_MODE
              }
              onSelectModel={onSelectModel}
              onSelectThinkingLevel={onSelectThinkingLevel}
              onSelectMode={onSelectMode}
              onSelectPermissionMode={onSelectPermissionMode}
              onBuiltin={onBuiltin}
            />
          </div>
          {decision ? <DecisionPanel>{decision}</DecisionPanel> : null}
        </div>
      )}
    </main>
  );
}
