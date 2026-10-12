/**
 * 预加载脚本：把服务地址、窗口镶边、窗口态与系统通知入口暴露给渲染层。
 *
 * 凭证不经过这里——主进程在发往服务 API 的请求头里注入，渲染层拿不到 `serviceToken`。
 * 通知同样不涉及凭证：渲染层只递文案与会话 id，弹窗与窗口聚焦在主进程（见 `main/notification.ts`）。
 */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { isFrameless } from "../shared/chrome.ts";
import type { DesktopConnection } from "../shared/connection.ts";
import {
  type DesktopNotificationRequest,
  NOTIFICATION_CLICK_CHANNEL,
  NOTIFY_CHANNEL,
} from "../shared/notification.ts";
import {
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type WindowControlAction,
  type WindowState,
} from "../shared/window-controls.ts";

contextBridge.exposeInMainWorld("desktop", {
  /** 无系统标题栏（系统红绿灯已收起），界面得自己画窗口控件与拖拽区 */
  frameless: isFrameless(process.platform),
  /** 关窗 / 最小化 / 全屏（绿点 ⌥ 是最大化）：自绘的窗口控件把动作递给主进程 */
  windowControl: (action: WindowControlAction): void =>
    ipcRenderer.send(WINDOW_CONTROL_CHANNEL, action),
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
  /** 订阅窗口态（自绘窗口控件失焦置灰、绿点按全屏切换符号用），返回退订函数 */
  onWindowState: (listener: (state: WindowState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: WindowState): void => listener(state);
    ipcRenderer.on(WINDOW_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.off(WINDOW_STATE_CHANNEL, handler);
    };
  },
});
