/**
 * 会话通知的判定：把会话列表的状态变化收敛成「该为哪条会话通知哪件事」。
 *
 * 纯逻辑，不碰 DOM 与通知 API（呈现见 `lib/notice`，唯一触发点见 `hooks/use-session-notices`）。
 * 口径来服务端下发的 `SessionSummary.status`，客户端只解释它，不另立一套判断。
 */
import type { SessionStatus, SessionSummary } from "@ucode/contracts";

/** 值得打扰用户的事件：等待类按挂起的请求细分，另有「本轮落定」与「本轮出错」 */
export type SessionNoticeKind =
  | "waiting_permission"
  | "waiting_question"
  | "waiting_plan"
  | "done"
  | "error";

export type SessionNotice = {
  sessionId: string;
  kind: SessionNoticeKind;
  /** 触发时的会话摘要，供调用方取标题 */
  session: SessionSummary;
};

/** 状态游标：记每个会话上次见到的状态，保证同一个状态只通知一次 */
export type NoticeCursor = Map<string, SessionStatus>;

/** 「这一轮还没释放」的中间态；由它落到 `idle` 才算一次任务完成 */
const isMidTurn = (status: SessionStatus): boolean =>
  status === "running" ||
  status === "waiting_permission" ||
  status === "waiting_question" ||
  status === "waiting_plan";

/**
 * 单个会话的变化该不该通知；`prev` 为空表示首次见到该会话，只建立基线、不通知。
 *
 * 子智能体的落定不算「任务完成」——它只是父会话的一个中间步骤，通知会盖过真正该看的那条。
 * 等待类状态也只在父会话上出现：子会话的挂起交互登记在父会话名下（服务端 `interactionSessionId`
 * 取 `parentSessionId ?? sessionId`），所以这里不为子会话另判「等授权」。
 */
export const noticeOf = (
  prev: SessionStatus | undefined,
  session: SessionSummary,
): SessionNoticeKind | null => {
  const next = session.status;
  if (prev === undefined || prev === next) return null;
  if (next === "waiting_permission" || next === "waiting_question" || next === "waiting_plan") {
    return next;
  }
  if (next === "error") return "error";
  if (next === "idle" && isMidTurn(prev) && session.parentSessionId === null) return "done";
  return null;
};

/** 是否真的打扰用户：开关打开，且页面不可见（页面可见即视为在读） */
export const shouldNotify = (options: { enabled: boolean; pageVisible: boolean }): boolean =>
  options.enabled && !options.pageVisible;

/**
 * 求这一批会话的通知并推进游标。
 *
 * 游标只留当前存在的会话（归档的不再累积），且无论是否通知都推进：
 * 用户在场时错过的状态不补发，否则切回标签页会一次性弹出一串过期通知。
 */
export const collectNotices = (
  cursor: NoticeCursor,
  sessions: readonly SessionSummary[],
): { notices: SessionNotice[]; cursor: NoticeCursor } => {
  const notices: SessionNotice[] = [];
  const next: NoticeCursor = new Map();
  for (const session of sessions) {
    next.set(session.id, session.status);
    const kind = noticeOf(cursor.get(session.id), session);
    if (kind) notices.push({ sessionId: session.id, kind, session });
  }
  return { notices, cursor: next };
};
