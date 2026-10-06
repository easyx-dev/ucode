/** 会话标题与归档确认：口径与侧栏保持一致，供各端复用 */
import type { SessionSummary } from "@ucode/contracts";
import type { TFunction } from "i18next";

/** 会话标题：优先用户命名，其次首条消息，最后兜底（注意用 || 而不是 ??，空串要落到兜底） */
export const sessionTitle = (session: SessionSummary, fallback: string): string =>
  session.name || session.preview.split("\n")[0]?.slice(0, 40) || fallback;

/**
 * 未读判定：距上次打开（标记已读）之后又有更新即未读。
 * 从未打开过的新会话也算未读；正在生成的不算，避免生成中的侧栏一直亮着未读点。
 */
export const isSessionUnread = (session: SessionSummary): boolean => {
  if (session.running) return false;
  if (!session.lastReadAt) return true;
  return session.updatedAt > session.lastReadAt;
};

/** 归档会话前的确认；标题口径与侧栏保持一致，有子会话时提示会级联归档 */
export const confirmArchiveSession = (session: SessionSummary, t: TFunction): boolean => {
  const name = sessionTitle(session, t("新会话"));
  return window.confirm(
    session.childCount > 0
      ? t("归档会话「{{name}}」？它的子会话会一并归档，对话与文件都保留。", { name })
      : t("归档会话「{{name}}」？会话会从列表里隐藏，对话与文件都保留。", { name }),
  );
};
