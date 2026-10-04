import type { TFunction } from "i18next";

import type { SessionSummary } from "./types";

/** 会话标题：优先用户命名，其次首条消息，最后兜底（注意用 || 而不是 ??，空串要落到兜底） */
export const sessionTitle = (session: SessionSummary, fallback: string): string =>
  session.name || session.preview.split("\n")[0]?.slice(0, 40) || fallback;

/** 归档会话前的确认；标题口径与侧栏保持一致，有子会话时提示会级联归档 */
export const confirmArchiveSession = (session: SessionSummary, t: TFunction): boolean => {
  const name = sessionTitle(session, t("新会话"));
  return window.confirm(
    session.childCount > 0
      ? t("归档会话「{{name}}」？它的子会话会一并归档，对话与文件都保留。", { name })
      : t("归档会话「{{name}}」？会话会从列表里隐藏，对话与文件都保留。", { name }),
  );
};
