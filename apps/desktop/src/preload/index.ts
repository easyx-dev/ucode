/**
 * 预加载脚本：把服务地址与系统通知入口暴露给渲染层。
 *
 * 凭证不经过这里——主进程在发往服务 API 的请求头里注入，渲染层拿不到 `serviceToken`。
 * 通知同样不涉及凭证：渲染层只递文案与会话 id，弹窗与窗口聚焦在主进程（见 `main/notification.ts`）。
 */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

import type { DesktopConnection } from "../shared/connection.ts";
import {
  type DesktopNotificationRequest,
  NOTIFICATION_CLICK_CHANNEL,
  NOTIFY_CHANNEL,
} from "../shared/notification.ts";

contextBridge.exposeInMainWorld("desktop", {
  connection: (): Promise<DesktopConnection> => ipcRenderer.invoke("desktop:connection"),
  notify: (request: DesktopNotificationRequest): Promise<boolean> =>
    ipcRenderer.invoke(NOTIFY_CHANNEL, request),
  /** 订阅通知点击，返回退订函数 */
  onNotificationClick: (listener: (sessionId: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, sessionId: string): void => listener(sessionId);
    ipcRenderer.on(NOTIFICATION_CLICK_CHANNEL, handler);
    return () => {
      ipcRenderer.off(NOTIFICATION_CLICK_CHANNEL, handler);
    };
  },
});
