/** preload 注入的桌面桥（见 src/preload/index.ts） */
import type { DesktopConnection } from "../../shared/connection.ts";

declare global {
  interface Window {
    desktop: {
      /** 取服务连接；未找到服务注册文件时 `baseUrl` 为 null */
      connection: () => Promise<DesktopConnection>;
    };
  }
}
