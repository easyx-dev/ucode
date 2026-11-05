/** 会话运行：把一条输入投递给会话，生成在服务端后台推进，结果走事件总线 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  type AttachmentRef,
  attachmentRefLine,
  type CommandRef,
  type ContextRef,
  ERROR_CODES,
  GOAL_PROMPT_CUSTOM_TYPE,
  type GoalPromptKind,
  type MessageCompactInput,
  type MessageEditInput,
  PLAN_APPROVED_CUSTOM_TYPE,
  type PromptInput,
  type SkillRef,
} from "@ucode/contracts";
import { resolveSessionCwd } from "../../core/session-paths";
import { resolveAttachment } from "../../harness/features/attachment";
import { inlineAttachmentText } from "../../harness/features/attachment/inline";
import { expandContexts } from "../../harness/features/context";
import { resolveEditableUserEntry } from "../../harness/features/edit";
import { buildPlanApproval } from "../../harness/features/goal/prompt";
import { type PromptImage, toPromptImage } from "../../harness/features/image";
import { titleMaterialOf } from "../../harness/features/title/generate";
import { expandPromptInvocation, expandSkillInvocation } from "../../harness/setup/assets/expand";
import { AppError } from "../../platform/response";
import { sleep } from "../../utils/time";
import type { Services } from "..";

/** 等占位的 run 真正进入 streaming（prompt 内部还有鉴权等异步步骤） */
const waitForBusy = async (
  session: AgentSession,
  isRunning: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.isStreaming) return true;
    if (!isRunning()) return false;
    await sleep(25);
  }
  return session.isStreaming;
};

/**
 * 开一轮后台生成：立即返回，不 await。
 * 这正是「刷新后仍能看到输出」的前提——run 的所有权在服务端，不在请求连接上。
 * 后台起轮与错误回传统一收敛在会话池，供 HTTP 触发与目标续跑共用。
 */
const startRun = (
  services: Services,
  sessionId: string,
  session: AgentSession,
  text: string,
  images: readonly PromptImage[] = [],
): void => {
  services.pool.startRun(sessionId, session, text, images);
};

/** 投递内容里与会话无关的那部分：前置展开块与 vision 数组都已备好，正文还没动 */
type PreparedPrompt = {
  /** 前置展开块（`@` 引用 + 退回老路径时的附件引用行），无内容时为空串 */
  prefix: string;
  /** 用户正文：附件内联成功时已把非图片标记换成引用行，否则原样 */
  text: string;
  images: PromptImage[];
  /** 这条输入是一条命令调用时带上：模型看到的模板正文由它决定 */
  command?: CommandRef;
  /** 这条输入用到的技能：模型看到的技能正文由它们决定，按顺序注入 */
  skills: readonly SkillRef[];
};

/** 输入是否有内容：正文、引用、附件、命令与技能至少一项（纯附件、纯引用、无参命令都算） */
const isEmptyInput = (input: {
  text: string;
  contexts: readonly ContextRef[];
  attachments: readonly AttachmentRef[];
  command?: CommandRef;
  skills: readonly SkillRef[];
}): boolean =>
  input.text.length === 0 &&
  input.contexts.length === 0 &&
  input.attachments.length === 0 &&
  !input.command &&
  input.skills.length === 0;

/**
 * 展开引用、按附件 id 取回内容。`prompt` 与 `edit` 都以这四项为投递内容，故按最小结构接收。
 * 越界路径与查不到的附件在这里就报错，不必先把会话实例建出来；
 * 命令与技能的展开要等会话装配好（模板来自 `session`），见 `assemblePrompt`。
 */
const preparePrompt = (
  repo: Services["attachments"],
  cwd: string,
  input: Pick<PromptInput, "text" | "contexts" | "attachments" | "command" | "skills">,
): PreparedPrompt => {
  const expanded = expandContexts(cwd, input.contexts ?? []);
  const resolved = (input.attachments ?? []).map((ref) => {
    const found = resolveAttachment(ref.id, { repo });
    if (!found) {
      throw new AppError(ERROR_CODES.invalidRequest, `附件不存在：${ref.id}`, 400, undefined, {
        path: ref.id,
      });
    }
    return found;
  });

  // 图片走 vision；其余本期只做引用（解析留给后续 read_attachment / MCP）
  const images = resolved.filter((found) => found.mimeType.startsWith("image/"));
  const files = resolved.filter((found) => !found.mimeType.startsWith("image/"));
  const inline = inlineAttachmentText(input.text, { imageCount: images.length, files });
  // 内联成功时引用行已经在正文里了，不再前置一份
  const refLines =
    inline === null ? files.map((file) => attachmentRefLine(file.name ?? file.id, file.id)) : [];

  return {
    prefix: [expanded, refLines.join("\n")].filter((part) => part.length > 0).join("\n\n"),
    text: inline ?? input.text,
    images: images.map(toPromptImage),
    ...(input.command ? { command: input.command } : {}),
    skills: input.skills ?? [],
  };
};

/** 名字对不上清单（模板被删、技能文件读不出来）时报错，理由见 `assemblePrompt` */
const unknownInvocation = (kind: "命令" | "技能", name: string): AppError =>
  new AppError(ERROR_CODES.invalidRequest, `${kind}不存在或不可用：${name}`, 400, undefined, {
    path: name,
  });

/**
 * 拼装模型要读的正文：`command` 与 `skills` 在这里换成边界块（模板正文 / 技能正文 + 各自参数），
 * 顺序固定为「命令块 → 技能块（按出现顺序）→ 用户正文」，前面还拼着引用块。
 *
 * 展开只能由服务端做——模板与技能正文都在会话装配里，客户端手里只有名字（见 `assets/expand.ts`）。
 * 名字对不上清单时报错而不是按普通消息投递：客户端是按清单把它定形成命令的，静默降级只会让
 * 用户写的参数变成发给模型的字面文本。
 */
const assemblePrompt = (
  prepared: PreparedPrompt,
  session: AgentSession,
): { body: string; images: PromptImage[] } => {
  const blocks: string[] = [];

  if (prepared.command) {
    const expanded = expandPromptInvocation(
      prepared.command.name,
      prepared.command.args,
      session.promptTemplates,
    );
    if (!expanded) throw unknownInvocation("命令", prepared.command.name);
    blocks.push(expanded.block);
  }

  for (const skill of prepared.skills) {
    const expanded = expandSkillInvocation(
      skill.name,
      skill.args,
      session.resourceLoader.getSkills().skills,
    );
    if (!expanded) throw unknownInvocation("技能", skill.name);
    blocks.push(expanded.block);
  }

  const body = [prepared.prefix, ...blocks, prepared.text]
    .filter((part) => part.length > 0)
    .join("\n\n");
  return { body, images: prepared.images };
};

/**
 * 把一条输入排进 pi 的队列：返回它**真的进了队列**（而不是被扩展当成指令消费掉）。
 * 报文里 `queued` 直接用它——客户端据此决定给不给「排队中」条，猜错会留下一条撤不回的假条目。
 */
const enqueue = async (
  session: AgentSession,
  body: string,
  images: PromptImage[] | undefined,
  behavior: PromptInput["behavior"],
): Promise<boolean> => {
  const disposition =
    behavior === "steer" ? await session.steer(body, images) : await session.followUp(body, images);
  return disposition === "queued";
};

/**
 * 受理一条输入：空闲则开新一轮并立即返回，生成中则按 behavior 排队。
 * 只 await「取会话」与「入队」这类短操作，不 await 整轮生成。
 *
 * 返回值告诉调用方这条输入是**开了新的一轮**还是**排进了队列**：客户端据此决定给不给乐观气泡
 * （排队的要等送出时才落成真消息，先插进列表会卡在上一轮输出的中间）。
 */
export const admitPrompt = async (
  services: Services,
  input: PromptInput,
): Promise<{ queued: boolean }> => {
  const { sessionId, text, behavior, command } = input;
  const contexts = input.contexts ?? [];
  const attachments = input.attachments ?? [];
  const skills = input.skills ?? [];

  // 会话必须先存在：查不到的 id 会一路走到「以会话工作目录当 cwd」的推导上，
  // 而那一步现在只认已有记录（见 `resolveSessionCwd`），这里提前给出明确的 404
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  if (isEmptyInput({ text, contexts, attachments, command, skills })) {
    throw new AppError(ERROR_CODES.invalidRequest, "消息不能为空", 400);
  }

  const prepared = preparePrompt(services.attachments, resolveSessionCwd(record), input);

  // 只在「创建/取回 AgentSession」这段加锁；run 本身不占锁，
  // 否则并发请求会一直排队到上一轮结束，steer / follow-up 永远不会生效
  const session = await services.pool.withLock(sessionId, () => services.pool.ensure(sessionId));

  const { body, images: content } = assemblePrompt(prepared, session);
  // 显式技能调用逐个留记录：界面上用户消息的 chip 已经表达过这件事，这里只落文件供后续统计
  for (const skill of prepared.skills) services.pool.noteSkillInvoke(sessionId, skill.name);

  // 装配成功后再把附件转为永久：ensure 失败（如未配模型）时不留下永不清理的附件
  services.attachments.markReferenced(
    attachments.map((ref) => ref.id),
    new Date().toISOString(),
  );

  /**
   * 开新一轮：先让标题服务看一眼是不是首轮（是就与这一轮同时起一次标题），再投递。
   * 排队（steer / follow-up）不算新一轮，也走不到这里。
   * 标题取用户那句：命令展开出来的模板正文会把标题带偏。
   */
  const beginTurn = (): void => {
    // 标题取用户那句（命令参数 / 正文 / 引用块）；都没有时由 `titleMaterialOf` 退回调用名
    services.titles.generateForPrompt(sessionId, session, titleMaterialOf(prepared));
    startRun(services, sessionId, session, body, content);
  };

  if (!services.pool.isRunning(sessionId) && !session.isStreaming) {
    beginTurn();
    return { queued: false };
  }

  const images = content.length > 0 ? content : undefined;
  if (await waitForBusy(session, () => services.pool.isRunning(sessionId))) {
    return { queued: await enqueue(session, body, images, behavior) };
  }

  /**
   * 占位还在但 pi 已经不是流式：要么首帧还没到（慢端点 / 上传），要么这一轮正在收尾。
   * 这时 `beginTurn` 会被占位挡住、报 409 把用户的话弹回输入框——排进队列更贴近意图
   * （它会在这一轮或下一轮的收尾处送出），撤回入口也已经在队列条上。
   */
  if (services.pool.isRunning(sessionId)) {
    return { queued: await enqueue(session, body, images, behavior) };
  }

  // 占位者已经结束（可能失败）：退化成新的一轮
  beginTurn();
  return { queued: false };
};

/**
 * 编辑一条已发送的用户消息并重发：把活动分支移回该消息之前，再以新内容开一轮。
 *
 * 与 `admitPrompt` 同一套投递口径：引用与附件按同一份 `preparePrompt` 展开、命令与技能同样换成
 * 边界块——否则编辑过的命令会以裸模板正文落盘，界面认不出命令，引用与附件也一并丢掉。
 *
 * 旧分支条目原样留在会话文件里（不删除、不总结），因此这一步不是「修改历史」而是「换一条分支继续」。
 * 与 prompt 不同，编辑不能在忙碌时排队——它改变的是本轮起点，必须等会话彻底空闲。
 */
export const admitEdit = async (services: Services, input: MessageEditInput): Promise<void> => {
  const { sessionId, entryId, text, command } = input;
  const contexts = input.contexts ?? [];
  const attachments = input.attachments ?? [];
  const skills = input.skills ?? [];

  const record = services.sessions.find(sessionId);
  if (!record || record.deletedAt) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  if (isEmptyInput({ text, contexts, attachments, command, skills })) {
    throw new AppError(ERROR_CODES.invalidRequest, "消息不能为空", 400);
  }
  // 子智能体会话只读、没有独立的重发语义
  if (record.parentSessionId || record.agent) {
    throw new AppError(ERROR_CODES.invalidRequest, "子智能体会话不支持编辑", 400);
  }

  // 与会话无关的展开先做：越界路径 / 查不到的附件 / 空输入在排队等锁之前就报错
  const prepared = preparePrompt(services.attachments, resolveSessionCwd(record), input);

  // 编辑先改活动分支再开生成，整段决策必须在同一把锁内完成：
  // 否则并发编辑会各自通过空闲检查、重复 navigateTree，把叶子改乱
  // startRun 只做占位、不占用锁，串行化的是决策点而不是整轮生成
  await services.pool.withLock(sessionId, async () => {
    const session = await services.pool.ensure(sessionId);
    // 压缩 / 分支总结 / 重试 / 排队也算不空闲
    if (services.pool.isActive(sessionId) || !session.isIdle) {
      throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
    }

    resolveEditableUserEntry(session.sessionManager.getBranch(), entryId);
    try {
      await session.navigateTree(entryId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AppError(ERROR_CODES.invalidRequest, `编辑失败：${reason}`, 400);
    }

    const { body, images } = assemblePrompt(prepared, session);
    // 编辑重发同样可能带技能，与 admitPrompt 一样逐个记下来
    for (const skill of prepared.skills) services.pool.noteSkillInvoke(sessionId, skill.name);
    // 与 admitPrompt 一致：装配成功后再把附件转为永久，避免失败时留下永不清理的附件
    services.attachments.markReferenced(
      attachments.map((ref) => ref.id),
      new Date().toISOString(),
    );
    // 活动分支已改变：让所有在线客户端丢弃本地历史、重新取快照
    services.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: entryId });
    startRun(services, sessionId, session, body, images);
  });
};

/**
 * 手动压缩：只在会话空闲时受理，压缩在服务端后台推进。
 * 与 prompt 不同不排队——忙碌时直接 409，避免改变正在进行的这一轮。
 * 压缩失败（内容太少、已压缩过、总结调用失败）在后台以 `compaction_failed` 回传。
 */
export const admitCompact = async (
  services: Services,
  input: MessageCompactInput,
): Promise<void> => {
  const { sessionId, instructions } = input;
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  const session = await services.pool.withLock(sessionId, () => services.pool.ensure(sessionId));
  if (services.pool.isActive(sessionId) || !session.isIdle) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正忙，请先中断", 409);
  }
  services.pool.startCompaction(sessionId, session, instructions);
};

/**
 * 目标模式触发的后台轮（启动 / 恢复目标）：会话必须已在跑之前的空闲状态。
 * 与 prompt 不同，这里不排队——目标续跑只在落定边界发生，运行中说明状态已变，直接拒绝。
 */
export const admitGoalRun = async (
  services: Services,
  sessionId: string,
  injected: { content: string; kind: GoalPromptKind },
): Promise<void> => {
  const session = await services.pool.withLock(sessionId, () => services.pool.ensure(sessionId));
  services.pool.startInjectedRun(sessionId, session, {
    customType: GOAL_PROMPT_CUSTOM_TYPE,
    content: injected.content,
    details: { kind: injected.kind },
  });
  // 注入不产生普通消息事件：客户端不重取快照就看不到那行「目标启动 / 目标恢复」
  services.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: "" });
};

/**
 * 计划批准：注入「已批准」的合成输入并起一轮。
 *
 * 切回 build 模式仍走 `sessions/update`（那里才是模式的校验与生效点），客户端先切后调这里；
 * 注入本身必须由服务端做——自定义条目只有会话这一侧写得进去。
 */
export const admitPlanApproval = async (services: Services, sessionId: string): Promise<void> => {
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  const session = await services.pool.withLock(sessionId, () => services.pool.ensure(sessionId));
  services.pool.startInjectedRun(sessionId, session, {
    customType: PLAN_APPROVED_CUSTOM_TYPE,
    content: buildPlanApproval(),
  });
  // 注入不产生普通消息事件：客户端不重取快照就看不到那行「计划已批准」
  services.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: "" });
};
