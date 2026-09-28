import type { SessionSummary } from "./types";

/** 会话标题：优先用户命名，其次首条消息，最后兜底（注意用 || 而不是 ??，空串要落到兜底） */
export const sessionTitle = (session: SessionSummary, fallback = "新会话"): string =>
  session.name || session.preview.split("\n")[0]?.slice(0, 40) || fallback;
