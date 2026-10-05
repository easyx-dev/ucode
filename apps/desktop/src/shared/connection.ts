/** preload 暴露给渲染层的连接信息（主进程与渲染层共用同一形状，避免两处各写一份） */
export type DesktopConnection = {
  /** 服务 API 根地址；未找到服务注册文件时为 null */
  baseUrl: string | null;
  /** 服务注册文件路径，供不可用态提示定位 */
  servicePath: string;
};
