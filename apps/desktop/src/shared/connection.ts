/** preload 暴露给渲染层的连接信息（主进程与渲染层共用同一形状，避免两处各写一份） */
export type DesktopConnection = {
  /** 服务注册文件是否读得到（读到即本机身份证明）；读不到时渲染层显示「未找到服务」 */
  registered: boolean;
  /** 服务注册文件路径，供不可用态提示定位 */
  servicePath: string;
  /**
   * 服务端点的 WebSocket 基址（`ws://127.0.0.1:<port>`，不含路径）。
   * 生产形态下渲染层的来源是 `app://desktop`，浏览器不会对自定义协议做 WS 升级，
   * 所以终端输出流必须直连这个地址（见 `renderer/main.tsx`）；开发形态走 Vite 代理，用渲染层自己的来源。
   */
  websocketUrl: string;
};
