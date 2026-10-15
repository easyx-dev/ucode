/** preload 注入的桌面桥（见 src/preload/index.ts） */
import type { DesktopBrowserTab } from "@ucode/contracts";
import type { DesktopConnection } from "../../shared/connection.ts";
import type { DesktopNotificationRequest } from "../../shared/notification.ts";
import type { WindowControlAction, WindowState } from "../../shared/window-controls.ts";

declare global {
  interface Window {
    desktop: {
      /** 无系统标题栏（系统红绿灯已收起）；界面据此画窗口控件与拖拽区 */
      frameless: boolean;
      /** 关窗 / 最小化 / 全屏（绿点 ⌥ 是最大化）：自绘窗口控件用 */
      windowControl: (action: WindowControlAction) => void;
      /** 取服务连接；服务未注册时 `registered` 为 false */
      connection: () => Promise<DesktopConnection>;
      /** 上报工作台里的浏览器标签（整份列表） */
      reportBrowserTabs: (tabs: DesktopBrowserTab[]) => void;
      /** 弹一条系统通知；返回是否真的显示出来 */
      notify: (request: DesktopNotificationRequest) => Promise<boolean>;
      /** 订阅通知点击，返回退订函数 */
      onNotificationClick: (listener: (sessionId: string) => void) => () => void;
      /** 订阅窗口态（自绘窗口控件失焦置灰、绿点按全屏切换符号用），返回退订函数 */
      onWindowState: (listener: (state: WindowState) => void) => () => void;
    };
  }
}
