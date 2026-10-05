/**
 * 预加载脚本：把服务地址暴露给渲染层。
 *
 * 凭证不经过这里——主进程在发往服务 API 的请求头里注入，渲染层拿不到 `serviceToken`。
 */
import { contextBridge, ipcRenderer } from "electron";

import type { DesktopConnection } from "../shared/connection.ts";

contextBridge.exposeInMainWorld("desktop", {
  connection: (): Promise<DesktopConnection> => ipcRenderer.invoke("desktop:connection"),
});
