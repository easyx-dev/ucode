/**
 * 窗口标题上的待处理提示：有会话在等用户（审批 / 问答 / 计划）时显示状态词，否则显示未读条数。
 *
 * 纯逻辑、不碰 DOM（写标题见 `./use-window-title`）。状态词优先于未读：前者要人立刻动手，
 * 后者只是「有东西没看」。状态口径取服务端下发的 `SessionSummary.status`，与 `./session-notice` 同源，
 * 客户端不另立一套判断。
 */
import type { SessionSummary } from "@ucode/contracts";
import type { TFunction } from "i18next";

import { isSessionUnread } from "../session/session";

/** 会写进标题的等待类状态，按「要人多快动手」排序（与服务端 `status` 的优先级同序） */
const WAITING_STATUSES = ["waiting_permission", "waiting_question", "waiting_plan"] as const;

export type WaitingStatus = (typeof WAITING_STATUSES)[number];

/** 标题里的短文案：通知里那套长句（「等待权限审批」）会把品牌名挤出标签页 */
const waitingTitle = (status: WaitingStatus, t: TFunction): string => {
  switch (status) {
    case "waiting_permission":
      return t("待审批");
    case "waiting_question":
      return t("待回答");
    case "waiting_plan":
      return t("待确认");
  }
};

/** 未读条数的上限：再多只写 `99+`，免得标题被数字吃掉 */
export const TITLE_UNREAD_LIMIT = 99;

export type WindowTitleNotice =
  | { kind: "waiting"; status: WaitingStatus }
  | { kind: "unread"; count: number };

/**
 * 该往标题上写什么；没有什么要提示的返回 null（标题保持品牌标题原样）。
 *
 * 等待类只取最先命中的那一类、而不是逐条会话：标题只放得下一个词，
 * 而「有人在等你审批」比「另外还有 3 条未读」更值得占这个位置。
 */
export const titleNoticeOf = (sessions: readonly SessionSummary[]): WindowTitleNotice | null => {
  for (const status of WAITING_STATUSES) {
    if (sessions.some((session) => session.status === status)) return { kind: "waiting", status };
  }
  const count = sessions.filter(isSessionUnread).length;
  return count > 0 ? { kind: "unread", count } : null;
};

/** 拼出最终标题；`base` 是品牌标题，即构建期注入到 html 的那一个常量 */
export const windowTitleOf = (
  notice: WindowTitleNotice | null,
  t: TFunction,
  base: string,
): string => {
  if (notice === null) return base;
  if (notice.kind === "waiting") return `${waitingTitle(notice.status, t)} · ${base}`;
  const count = notice.count > TITLE_UNREAD_LIMIT ? `${TITLE_UNREAD_LIMIT}+` : String(notice.count);
  return `(${count}) ${base}`;
};
