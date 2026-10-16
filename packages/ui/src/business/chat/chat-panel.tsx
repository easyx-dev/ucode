/** 对话区：头部 + 错误提示 + 消息列表 + 输入区（等用户决策时换成决策区） */

import { type DocNode, docToDialect, relativizeContextRefs, textToDoc } from "@ucode/markdown";
import { cn } from "cn";
import { Bot } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import type { ChatController } from "../../hooks/store/use-chat";
import { useProjects } from "../../hooks/store/use-projects";
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
} from "../../types";
import type { BuiltinCommandId } from "../composer/builtin-commands";
import { Composer } from "../composer/composer";
import { composerKeyOf, emptyDraft } from "../composer/document/composer-draft";
import type { ComposerPayload } from "../composer/document/composer-payload";
import { draftSeedOf, projectLabel, projectOf } from "../composer/project/project";
import type { ComposerDraftsController } from "../composer/use-composer-drafts";
import { GoalBar } from "../goal/goal-bar";
import { type GoalCommand, parseGoalCommand } from "../goal/goal-command";
import { isWorkspaceSession } from "../session/session-groups";
import { buildSessionActivity } from "./activity/session-activity";
import { SessionActivityDock } from "./activity/session-activity-dock";
import { openSubagentSessionDialog } from "./activity/subagent-session-dialog";
import { ChatHeader } from "./chat-header";
import { DecisionPanel } from "./decision/decision-panel";
import { PermissionRequest } from "./decision/permission-request";
import { PlanDecisionForm } from "./decision/plan-decision-form";
import { QuestionRequest } from "./decision/question-request";
import { buildGoalTurns } from "./message/goal-turns";
import { MessageList } from "./message/message-list";
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
  /**
   * 无标题栏窗口顶部那条的高度（px）：> 0 时顶部就是标题条，对话区头部整行可拖
   */
  titleBarInset?: number;
  /**
   * 自绘窗口控件的横向占位宽度（px，仅无标题栏窗口需要）：侧栏收起时它就在对话区头部左端，
   * 头部得右移这么多把位置让出来；0 表示不用让。
   */
  windowControlsWidth?: number;
  /** 自绘窗口控件的宿主节点：收起侧栏时挂到头部（头部是拖拽区，控件得是它的后代） */
  windowControls?: ReactNode;
  /** 展开 / 收起工作台（右侧第三栏）；移动端唤出抽屉 */
  onToggleWorkbench?: () => void;
  /** 工作台是否展开 */
  workbenchOpen?: boolean;
  /** 双击标题就地改名（新名称弹层由上层管） */
  onRenameSession?: () => void;
  /** 取本会话的原始记录（JSONL 文本）用于复制；不传则不显示这个入口 */
  onLoadTranscript?: () => Promise<string>;
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
  titleBarInset,
  windowControlsWidth,
  windowControls,
  onToggleWorkbench,
  workbenchOpen,
  onRenameSession,
  onLoadTranscript,
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
  /** 活动面板：从工具行的入口点进来时带上要定位的子智能体；`null` 表示用户还没选过展开态 */
  const [activityOpen, setActivityOpen] = useState<boolean | null>(null);
  const [activityFocus, setActivityFocus] = useState<string | null>(null);
  const activity = useMemo(
    () =>
      buildSessionActivity({
        subagents: chat.subagents,
        services: chat.services,
        goal: goal ?? null,
        goalTurns,
      }),
    [chat.subagents, chat.services, goal, goalTurns],
  );
  const openActivity = useCallback((toolCallId?: string): void => {
    setActivityFocus(toolCallId ?? null);
    setActivityOpen(true);
  }, []);
  // 面板打开时重探一次后台服务：清单是运行态，命令之外的进程把服务停了只有这一问能发现
  const refreshServices = chat.refreshServices;
  useEffect(() => {
    if (activityOpen) void refreshServices();
  }, [activityOpen, refreshServices]);
  const projects = useProjects();
  const draftKey = composerKeyOf(session?.id ?? null);
  const draft = composer.drafts[draftKey] ?? emptyDraft();

  /**
   * 草稿里的编辑器文档：优先用存下来的 doc；只有旧 `text` 的按单段落还原。
   * 切换会话 / 失败回填会让编辑器重挂载，因此这里作为「初始文档」传入。
   */
  const initialDoc: DocNode | undefined =
    (draft.doc as DocNode | undefined) ?? (draft.text ? textToDoc(draft.text) : undefined);

  /**
   * 发送：清空草稿（即时反馈 + 挡重复提交），把初始设置交给 useChat——还没有会话时先建会话；
   * 没发出去就把那份文档（引用与附件都在节点里）还回输入框
   * （会话可能已经建好，按返回的会话 id 定位上下文）。
   * `/goal` 只在纯文本时才当命令解析，带引用 / 图片的消息按普通消息发。
   */
  const submit = useCallback(
    (payload: ComposerPayload, doc: DocNode) => {
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
          text: docToDialect(doc, {}),
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
      // 四周留白都由外壳容器留（见 DESIGN.md「间距与尺寸」），网格与卡片的间隙交给分隔条；
      // 贴窗口的面板取 `rounded-md`：与窗口自身的圆角相称（见 DESIGN.md「圆角」）
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface md:rounded-md md:border md:border-border"
    >
      <ChatHeader
        session={session}
        models={models}
        onReloadModels={onReloadModels}
        onOpenSettings={onOpenSettings}
        onToggleSidebar={onToggleSidebar}
        sidebarCollapsed={sidebarCollapsed}
        titleBarInset={titleBarInset}
        windowControlsWidth={windowControlsWidth}
        windowControls={windowControls}
        onToggleWorkbench={onToggleWorkbench}
        workbenchOpen={workbenchOpen}
        onRenameSession={onRenameSession}
        onBackToParent={onBackToParent}
        onOpenForkSource={onOpenSession}
        forkedFromName={forkedFromName}
        usage={usage}
        context={context}
        onOpenUsage={onOpenUsage}
        streaming={chat.streaming}
        onLoadTranscript={onLoadTranscript}
      />

      {chat.error ? (
        <div className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {chat.error}
        </div>
      ) : null}

      {hero ? null : (
        // 活动面板与悬浮摘要条挂在对话区右下角：包一层 relative 容器，与消息列表同级（子会话不挂）
        <div className="relative flex min-h-0 flex-1 flex-col">
          <MessageList
            items={chat.items}
            subagents={chat.subagents}
            loading={chat.loadingHistory}
            working={chat.streaming}
            compacting={chat.compacting}
            resetKey={session?.id ?? ""}
            sentTick={sentTick}
            onOpenSession={openSubagent}
            onOpenActivity={isChild ? undefined : openActivity}
            onFork={isChild ? undefined : onFork}
            onEdit={isChild || chat.streaming ? undefined : handleEdit}
          />
          {isChild ? null : (
            <SessionActivityDock
              activity={activity}
              open={activityOpen}
              focusToolCallId={activityFocus}
              onOpenChange={setActivityOpen}
              onOpenSubagent={openSubagent}
            />
          )}
        </div>
      )}

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
              // 目标栏是输入卡的上沿一条，随卡一起被决策面板的底衬盖住；
              // 完成后不再挂它：目标在哪儿结束由对话里的「目标完成」细线负责
              topBar={
                goal && goal.status !== "completed" ? (
                  <GoalBar
                    goal={goal}
                    turns={goalTurns}
                    onCommand={(command) => onGoalCommand(command)}
                    onBudget={onGoalBudget}
                  />
                ) : null
              }
              onDocChange={(doc) => composer.update(draftKey, { doc, text: docToDialect(doc, {}) })}
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
