/**
 * 「消息通知」开关的 React 绑定：设置页读写它，并在用户手势里补上浏览器授权。
 *
 * 触发点每次发通知前现读 localStorage，故不需要跨组件广播；这里只为设置页提供受控值与授权状态。
 */
import { useState, useSyncExternalStore } from "react";

import {
  type NoticePermissionState,
  noticePermissionState,
  readDesktopDelivered,
  readNoticeEnabled,
  requestNoticePermission,
  subscribeDesktopDelivered,
  writeNoticeEnabled,
} from "../lib/notice";

export function useNoticeEnabled(): {
  noticeEnabled: boolean;
  /** 通知能不能送达：未授权时设置页要给出授权入口或排障提示 */
  noticePermission: NoticePermissionState;
  /** 桌面端最近一次通知被系统拦下（web 端恒为 false） */
  noticeBlocked: boolean;
  /** 在用户手势里申请授权 */
  requestPermission: () => Promise<void>;
  setNoticeEnabled: (next: boolean) => void;
} {
  const [noticeEnabled, setEnabled] = useState(readNoticeEnabled);
  const [noticePermission, setPermission] = useState<NoticePermissionState>(noticePermissionState);
  // 桌面端查不到授权状态，只能看最近一次投递的结果
  const noticeBlocked = useSyncExternalStore(
    subscribeDesktopDelivered,
    () => readDesktopDelivered() === false,
  );

  return {
    noticeEnabled,
    noticePermission,
    noticeBlocked,
    requestPermission: async () => {
      setPermission((await requestNoticePermission()) ? "granted" : noticePermissionState());
    },
    setNoticeEnabled: (next) => {
      writeNoticeEnabled(next);
      setEnabled(next);
      // 开关本来就是用户手势：顺手申请授权，浏览器才会真的弹窗
      if (next) {
        void requestNoticePermission().then((granted) => {
          if (granted) setPermission("granted");
        });
      }
    },
  };
}
