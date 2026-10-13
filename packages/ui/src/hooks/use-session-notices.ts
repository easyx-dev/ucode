/**
 * 会话通知的唯一触发点：订阅 sessions store，把状态变化收敛成系统通知，点击后回到对应会话。
 *
 * web 与桌面端共用这一处判定，平台差异只在 `lib/notice`。免打扰口径是「人不在才通知」：
 * web 看页面可见性、桌面端看窗口焦点（`isUserPresent`），可见即视为在读，开关在设置的外观页、落 localStorage，两者都在 `lib/notice` 与 `lib/session-notice` 里。
 * 提示音是另一个通道（见 `lib/sound`）：它有自己的开关，且不看页面可见性——人就坐在前台，
 * 声音仍要比界面更早把人叫回来；系统通知不重复打扰。
 */
import type { SessionSummary } from "@ucode/contracts";
import type { SessionsState } from "@ucode/sdk";
import type { TFunction } from "i18next";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isUserPresent, readNoticeEnabled, showNotice, subscribeNoticeClick } from "../lib/notice";
import { sessionTitle } from "../lib/session";
import { collectNotices, type SessionNoticeKind, shouldNotify } from "../lib/session-notice";
import { playNoticeSound, readSoundEnabled } from "../lib/sound";
import { useClient } from "../provider";

export type SessionNoticesOptions = {
  /** 点击通知后回到哪个会话：由应用层的导航状态承接 */
  onSelectSession: (sessionId: string) => void;
};

/** 通知标题就是事件本身，会话标题放正文 */
const noticeTitle = (kind: SessionNoticeKind, t: TFunction): string => {
  switch (kind) {
    case "waiting_permission":
      return t("等待权限审批");
    case "waiting_question":
      return t("等待你的回答");
    case "waiting_plan":
      return t("等待计划确认");
    case "done":
      return t("会话已完成");
    case "error":
      return t("会话出错");
  }
};

/**
 * 根列表 + 已加载的子会话，按 id 去重。
 * 收子会话是为了它的出错状态；等待类状态只出现在父会话上（子会话的挂起交互登记在父会话名下）。
 */
const collectSessions = (state: SessionsState): SessionSummary[] => {
  const byId = new Map<string, SessionSummary>();
  for (const session of state.list) byId.set(session.id, session);
  for (const children of Object.values(state.childrenByParent)) {
    for (const child of children) byId.set(child.id, child);
  }
  return [...byId.values()];
};

export function useSessionNotices({ onSelectSession }: SessionNoticesOptions): void {
  const client = useClient();
  const { t } = useTranslation();
  // 点击回调与文案随渲染更新，但订阅只建一次，故两者都从 ref 现取
  const selectRef = useRef(onSelectSession);
  selectRef.current = onSelectSession;
  const translateRef = useRef(t);
  translateRef.current = t;

  // 桌面端的系统通知由主进程回传点击（web 的通知自带 onclick，这里是空订阅）
  useEffect(() => subscribeNoticeClick((sessionId) => selectRef.current(sessionId)), []);

  useEffect(() => {
    const sessions = client.sessions;
    // 首帧只建立基线：打开应用不该为历史状态补发通知
    let cursor = collectNotices(new Map(), collectSessions(sessions.getState())).cursor;

    return sessions.subscribe(() => {
      const collected = collectNotices(cursor, collectSessions(sessions.getState()));
      cursor = collected.cursor;
      if (collected.notices.length === 0) return;
      // 先响铃再发通知：声音不依赖通知开关与页面可见性
      if (readSoundEnabled()) playNoticeSound();
      if (!shouldNotify({ enabled: readNoticeEnabled(), pageVisible: isUserPresent() })) return;

      const t = translateRef.current;
      for (const notice of collected.notices) {
        showNotice(
          {
            title: noticeTitle(notice.kind, t),
            body: sessionTitle(notice.session, t("新会话")),
            sessionId: notice.sessionId,
          },
          (sessionId) => selectRef.current(sessionId),
        );
      }
    });
  }, [client]);
}
