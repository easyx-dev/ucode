/** /api/v1/messages：会话历史读取，以及发起生成（投递）、编辑重发、中断、忽略 / 批准计划 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  ERROR_CODES,
  type MessageApprovePlanResponse,
  type MessageDequeueResponse,
  type MessageIgnorePlanResponse,
  type MessageInterruptResponse,
  type MessageListResponse,
  type MessageServicesResponse,
  messageApprovePlanInputSchema,
  messageCompactInputSchema,
  messageEditInputSchema,
  messageListInputSchema,
  messageServicesInputSchema,
  PLAN_IGNORED_CUSTOM_TYPE,
  type PromptAdmittedResponse,
  promptInputSchema,
  sessionIdInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import { resolveSessionCwd } from "../../core/session-paths";
import { env } from "../../env";
import { materializeAttachment } from "../../harness/features/attachment";
import { projectMessages } from "../../harness/pi/projection";
import { transcriptExtrasOf, transcriptStates } from "../../harness/pi/serialize";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";
import {
  admitCompact,
  admitEdit,
  admitPlanApproval,
  admitPrompt,
} from "../../services/sessions/run";

export const createMessagesRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(messageListInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const record = services.sessions.find(sessionId);
    const live = services.pool.get(sessionId);
    // 会话在池中时以它的内存条目为准：草稿（首轮回复完成前）还没写 JSONL，
    // 只读文件会让刷新后的对话区空着，直到首条 assistant 消息落盘
    const manager =
      live?.sessionManager ??
      (record?.sourcePath
        ? SessionManager.open(record.sourcePath, env.sessionsDir, resolveSessionCwd(record))
        : null);
    const entries = manager ? manager.buildContextEntries() : [];
    const branch = manager ? manager.getBranch() : [];
    // 会话级设置沿完整路径推进：压缩只裁剪展示条目，看裁剪后的列表会让压缩点之后丢档位
    const states = transcriptStates(branch);

    // 序号与投影必须在同一同步块内取：中间一旦插入事件，
    // 客户端按 seq 切分实时帧时就会重复渲染或漏掉一段增量
    const seq = services.events.latestSeq(sessionId);
    const projection = projectMessages(sessionId, live, entries, states, {
      // 历史里的图片按需落进附件库（幂等）：界面按附件路由取字节，而它们原本只以 base64 在会话记录里；
      // `extras` 把「原始条目里的图片」与「哪些条目被旧输出清理过」一并带进来（见 TranscriptExtras）
      writeImage: (id, bytes, mimeType) =>
        materializeAttachment(id, bytes, mimeType, { repo: services.attachments }),
      extras: transcriptExtrasOf(branch),
    });

    return c.json(
      ok({
        sessionId,
        // 会话不存在（例如刚被归档）时没有可报的目录，交给客户端按空串处理
        cwd: record ? resolveSessionCwd(record) : "",
        persisted: Boolean(record?.sourcePath),
        running: services.pool.isActive(sessionId),
        // 生成中投递的输入条数：队列只存在于服务端内存（实例被回收即无队列）
        queued: services.pool.get(sessionId)?.pendingMessageCount ?? 0,
        // 嵌套进度不落盘：断流重连后客户端靠这份清单收敛（快照里没有的即已结束）
        subagents: services.pool.runningSubagentsOf(sessionId),
        // 后台服务同样只是运行态：快照里没有的即已不再可连（重探发生在 bash 结算与落定时）
        services: services.pool.listServicesOf(sessionId),
        seq,
        ...projection,
      } satisfies MessageListResponse),
    );
  });

  // 后台服务清单的单独读取：活动面板打开时用它拿「此刻」的状态——
  // 不为一份小清单重取整段消息历史（/list 是会话全量投影，随历史线性变重）
  router.post("/services", jsonBody(messageServicesInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const tracked = await services.pool.refreshServices(sessionId);
    return c.json(ok({ sessionId, services: tracked } satisfies MessageServicesResponse));
  });

  // 只做受理：真正的生成在服务端后台推进，结果统一走 /events
  router.post("/prompt", jsonBody(promptInputSchema), async (c) => {
    const input = c.req.valid("json");
    const { queued } = await admitPrompt(services, input);
    return c.json(
      ok({
        sessionId: input.sessionId,
        admitted: true,
        queued,
      } satisfies PromptAdmittedResponse),
    );
  });

  // 编辑一条用户消息并重发：同样只做受理，生成在后台推进；旧分支保留在会话文件里
  router.post("/edit", jsonBody(messageEditInputSchema), async (c) => {
    const input = c.req.valid("json");
    await admitEdit(services, input);
    return c.json(
      ok({
        sessionId: input.sessionId,
        admitted: true,
        // 编辑会改变本轮起点，只能在空闲时受理，不排队
        queued: false,
      } satisfies PromptAdmittedResponse),
    );
  });

  /**
   * 撤回排队中的输入（「生成中发消息」刚排进去的那些）。
   *
   * pi 的 `clearQueue()` 只能整清，没有逐条移除的口子，所以这里一次退全部；
   * 返回条数给客户端核对「撤掉了几条」。清空后 pi 自己会发一帧 `queue_update`，不必再补。
   */
  router.post("/dequeue", jsonBody(sessionIdInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const record = services.sessions.find(sessionId);
    if (!record || record.deletedAt) {
      throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
        path: sessionId,
      });
    }

    // 队列只在会话实例的内存里：实例已被回收时就没有可撤的东西
    const cleared = services.pool.get(sessionId)?.clearQueue();
    const queued = (cleared?.steering.length ?? 0) + (cleared?.followUp.length ?? 0);
    return c.json(ok({ sessionId, queued } satisfies MessageDequeueResponse));
  });

  router.post("/interrupt", jsonBody(sessionIdInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const aborted = await services.pool.abort(sessionId);
    return c.json(ok({ sessionId, aborted } satisfies MessageInterruptResponse));
  });

  // 忽略本次计划的决策表单：往会话文件追加一条 custom 标记条目，本轮不再弹表单
  // 标记只作扩展状态、不进模型上下文，也不触发新一轮；多窗口同步复用 transcript_reset
  router.post("/ignore-plan", jsonBody(sessionIdInputSchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const record = services.sessions.find(sessionId);
    if (!record || record.deletedAt) {
      throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
        path: sessionId,
      });
    }

    // 与 prompt / edit 共用同一把锁：否则并发的 pool.ensure 会另开一个 manager 指向同一段历史，
    // 各自持叶子各写一条子节点，产生旁支、标记挂不到活动分支上（列表与前端都看不到）
    const ignored = await services.pool.withLock(sessionId, async () => {
      // 生成 / 压缩中追加会把标记插进本轮中途，而本轮起点已定，直接拒绝
      if (services.pool.isActive(sessionId)) {
        throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
      }
      // 与 /messages/list 同款取法：池内实例的内存叶子才是权威；被 idle 回收后从文件 open
      // （pi 的 _buildIndex 以 JSONL 最后一行作叶子，append-only 保证它正是活动分支尖端）
      const live = services.pool.get(sessionId);
      const manager =
        live?.sessionManager ??
        (record.sourcePath
          ? SessionManager.open(record.sourcePath, env.sessionsDir, resolveSessionCwd(record))
          : undefined);
      if (!manager) {
        throw new AppError(ERROR_CODES.invalidRequest, "会话还没有落盘，无法忽略计划", 400);
      }

      // 幂等：末尾已是标记（重复点击 / 多窗口）不重复追加；检查与追加之间保持同步
      const leaf = manager.getLeafEntry();
      if (leaf?.type === "custom" && leaf.customType === PLAN_IGNORED_CUSTOM_TYPE) {
        return false;
      }

      const entryId = manager.appendCustomEntry(PLAN_IGNORED_CUSTOM_TYPE, {
        at: new Date().toISOString(),
      });
      services.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: entryId });
      return true;
    });

    return c.json(ok({ sessionId, ignored } satisfies MessageIgnorePlanResponse));
  });

  // 批准计划：模式已由客户端切回 build，这里注入开工指令并起一轮（注入只有服务端做得出来）
  router.post("/approve-plan", jsonBody(messageApprovePlanInputSchema), async (c) => {
    const input = c.req.valid("json");
    await admitPlanApproval(services, input.sessionId);
    return c.json(
      ok({ sessionId: input.sessionId, admitted: true } satisfies MessageApprovePlanResponse),
    );
  });

  // 手动压缩：只做受理，压缩在后台推进，进度与结果走 /events 的 compaction_* 帧
  router.post("/compact", jsonBody(messageCompactInputSchema), async (c) => {
    const input = c.req.valid("json");
    await admitCompact(services, input);
    return c.json(
      ok({
        sessionId: input.sessionId,
        admitted: true,
        // 压缩不排队：忙碌时直接 409
        queued: false,
      } satisfies PromptAdmittedResponse),
    );
  });

  return router;
};
