import type { TFunction } from "i18next";

import type { SessionSummary } from "./types";

/** 会话标题：优先用户命名，其次首条消息，最后兜底（注意用 || 而不是 ??，空串要落到兜底） */
export const sessionTitle = (session: SessionSummary, fallback: string): string =>
  session.name || session.preview.split("\n")[0]?.slice(0, 40) || fallback;

/** 删除会话前的确认；标题口径与侧栏保持一致 */
export const confirmDeleteSession = (session: SessionSummary, t: TFunction): boolean =>
  window.confirm(t("删除会话确认", { name: sessionTitle(session, t("新会话")) }));
