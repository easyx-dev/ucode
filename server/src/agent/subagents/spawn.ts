/**
 * 子会话语义：建子会话行 → 走会话池取实例 → 前台 prompt → 取最终文本 → 回收。
 *
 * 复用会话池（而不是直接 `createAgentSession`）是为了让子会话天然落盘、接入事件总线，
 * 后续的进度流式与导航都走同一条链路。
 */
import { randomUUID } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@ucode/contracts";

import { SUBAGENT_DESCRIPTION_MAX_LENGTH, SUBAGENT_TIMEOUT_MS } from "../../constants";
import type { SessionRecord } from "../../db/session-repository";
import { isRecord } from "../../utils/object";
import { type AgentRegistry, subagentProfile } from "../agents";
import { resolveContextPlan } from "./context";
import type { SubagentRequest, SubagentResult } from "./types";

export type SubagentSpawnDeps = {
  createChild: (
    id: string,
    input: {
      parentId: string;
      cwd: string;
      mode: string;
      agent: string;
      name: string;
      model?: string;
      thinkingLevel?: ThinkingLevel;
    },
  ) => void;
  /** 装配失败时丢弃刚建的行（此时还没有文件，硬删） */
  discardChild: (sessionId: string) => void;
  ensure: (sessionId: string) => Promise<AgentSession>;
  /** 查子会话行；续跑（`task_id`）时校验归属与角色，并复用已有会话 */
  findChild: (sessionId: string) => SessionRecord | undefined;
  /** 子会话落定后回写索引（source_path / preview），供列表与导航使用 */
  refresh: (sessionId: string) => void;
  /** 新建子会话成功装配后下发 `session_created`，供其它客户端把子会话插入列表 */
  emitSessionCreated: (sessionId: string) => void;
  /** 结算该子会话发起的挂起交互（归属父会话，但只清来源是它的） */
  settleInteractions: (sessionId: string) => void;
  dispose: (sessionId: string) => void;
  /** 只发关联帧（`toolCallId ↔ 子会话 id`），子会话进度帧仍由它自身的广播承载 */
  emit: (type: "subagent_start" | "subagent_end", data: Record<string, unknown>) => void;
};

/**
 * 子智能体自身的失败：用来区分「子会话内部报错」与「超时 / 中止」。
 * 后者已是可读文案，前者由 `toReadableError` 归一。
 */
class SubagentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubagentError";
  }
}

/** 原始错误信息截断长度：够定位问题，又不把大段内部栈塞进工具结果 */
const MAX_ERROR_CHARS = 500;

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join(" ");
};

/**
 * 子会话最后一条有正文的 assistant 文本：它是父会话唯一能看到的产出。
 * 末条 assistant 可能只有工具调用而没有正文，所以要跳过空的继续往前找。
 */
const lastAssistantText = (session: AgentSession): string => {
  const entries = session.sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    const text = textOf(entry.message.content).trim();
    if (text) return text;
  }
  return "";
};

const toReadableError = (error: unknown): SubagentError => {
  if (error instanceof SubagentError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SubagentError(`子智能体执行失败：${message.slice(0, MAX_ERROR_CHARS)}`);
};

/**
 * 前台跑一条 prompt，带超时与中止；两者都 abort 子会话，避免它继续烧 token。
 * 只结算一次（超时 / 中止 / 正常结束三者竞争）。
 */
const promptChild = (child: AgentSession, task: string, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void child.abort();
      reject(new SubagentError(message));
    };
    const onAbort = (): void => fail("子智能体已中止。");
    const timer = setTimeout(
      () => fail("子智能体执行超时，已中止；请缩小任务范围后重试。"),
      SUBAGENT_TIMEOUT_MS,
    );
    if (signal?.aborted) {
      fail("子智能体已中止。");
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.prompt(task).then(
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(toReadableError(error));
      },
    );
  });

export const spawnSubagent = async (
  input: {
    parent: SessionRecord;
    /** 父会话里这次 `subagent` 调用的 id，用于关联子会话进度 */
    toolCallId: string;
    /** 父会话工作目录；子会话在同一个目录里干活 */
    cwd: string;
    request: SubagentRequest;
    /** 子角色注册表（含自定义角色）；缺省只认内置角色 */
    registry?: AgentRegistry;
    signal?: AbortSignal;
  },
  deps: SubagentSpawnDeps,
): Promise<SubagentResult> => {
  const { request } = input;
  // 续跑：先取出原子会话，校验归属 / 归档 / 角色一致性，再据此解析角色
  const resumed = request.taskId ? deps.findChild(request.taskId) : undefined;
  if (request.taskId) {
    if (!resumed || resumed.parentSessionId !== input.parent.id) {
      throw new SubagentError("找不到可续跑的子会话，或它不属于当前会话。");
    }
    if (resumed.deletedAt) throw new SubagentError("该子会话已归档，无法续跑。");
    if (request.agent && request.agent !== resumed.agent) {
      throw new SubagentError(
        `该子会话的角色是 ${resumed.agent}，与指定的 ${request.agent} 不一致，无法续跑。`,
      );
    }
    // 模型 / 档位只在新建时写入子会话行，续跑时无法生效；显式拒绝好过静默忽略
    if (request.model || request.thinkingLevel) {
      throw new SubagentError("续跑不支持覆盖模型 / 思考档位；如需更换请新建子会话。");
    }
  }

  const profile = subagentProfile(request.agent ?? resumed?.agent ?? undefined, input.registry);
  const contextPlan = resolveContextPlan(profile);
  // fork 上下文与「会话分叉」共用原语，尚未实现；这里失败关闭而不是静默按 fresh 跑
  if (contextPlan.kind !== "fresh") {
    throw new Error("子智能体的 fork 上下文尚未开放。");
  }

  const childId = resumed?.id ?? `sub-${randomUUID()}`;
  const name =
    resumed?.name?.trim() ||
    request.description?.trim().slice(0, SUBAGENT_DESCRIPTION_MAX_LENGTH) ||
    profile.label;

  // 续跑复用已有子会话行与 JSONL；只有新建才落行
  if (!resumed) {
    deps.createChild(childId, {
      parentId: input.parent.id,
      cwd: input.cwd,
      mode: input.parent.mode,
      agent: profile.slug,
      name,
      ...(request.model ? { model: request.model } : {}),
      ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
    });
  }

  let child: AgentSession;
  try {
    child = await deps.ensure(childId);
  } catch (error) {
    // 装配失败（模型未配置等）：删掉刚建的空行，否则会留一条永远没有文件的子会话。
    // 续跑时行是早已存在的，不能当空行删掉
    if (!resumed) deps.discardChild(childId);
    throw error;
  }

  // 只有新建才广播 session_created：续跑复用已有行，客户端早已见过
  if (!resumed) deps.emitSessionCreated(childId);

  // 只发关联帧：前端据此把该子会话自身的进度帧归入父会话里这次工具调用，不重发子会话事件
  deps.emit("subagent_start", {
    toolCallId: input.toolCallId,
    sessionId: childId,
    description: name,
  });

  let isError = false;
  try {
    await promptChild(child, input.request.task, input.signal);
    return { sessionId: childId, text: lastAssistantText(child) };
  } catch (error) {
    isError = true;
    throw error;
  } finally {
    deps.emit("subagent_end", { toolCallId: input.toolCallId, sessionId: childId, isError });
    // 失败（超时 / 中止）也要回写：子会话可能已写出 JSONL，不回写会永远停在「未落盘」的草稿口径
    deps.refresh(childId);
    // 子会话挂起的审批 / 提问归属父会话，结束时一并结算，避免它超时前一直挂在前端
    deps.settleInteractions(childId);
    deps.dispose(childId);
  }
};
