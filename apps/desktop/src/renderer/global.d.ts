/** preload 注入的桌面桥（见 src/preload/index.ts） */
import type { DesktopConnection } from "../../shared/connection.ts";
import type { DesktopNotificationRequest } from "../../shared/notification.ts";

declare global {
  interface Window {
    desktop: {
      /** 取服务连接；未找到服务注册文件时 `baseUrl` 为 null */
      connection: () => Promise<DesktopConnection>;
      /** 弹一条系统通知；返回是否真的显示出来 */
      notify: (request: DesktopNotificationRequest) => Promise<boolean>;
      /** 订阅通知点击，返回退订函数 */
      onNotificationClick: (listener: (sessionId: string) => void) => () => void;
    };
  }
}
