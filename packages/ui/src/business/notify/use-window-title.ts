/**
 * 把待处理状态写进窗口标题：web 是标签页标题，桌面端是窗口标题（Electron 的窗口标题由 `document.title` 驱动）。
 *
 * 只算根会话：等待类状态只出现在父会话上（子会话的挂起交互登记在父会话名下），
 * 子会话的未读也不该占标题——侧栏折叠时看到的正是根列表这一份。
 * 只在工作区挂载期间生效：登录页 / 服务不可用时组件不在，标题还原成品牌标题。
 */
import { brand } from "@ucode/brand";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useSessions } from "../../hooks/store/use-sessions";
import { titleNoticeOf, windowTitleOf } from "./title-notice";

export function useWindowTitle(): void {
  const { sessions } = useSessions();
  // 切换语言要重写标题（状态词跟着语言走），故把当前语言也算进依赖
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.title = windowTitleOf(titleNoticeOf(sessions), t, brand.title);
  }, [sessions, t, i18n.resolvedLanguage]);

  // 离开工作区时不能把上一次的提示留在窗口上
  useEffect(
    () => () => {
      document.title = brand.title;
    },
    [],
  );
}
