/** preload 暴露给渲染层的连接信息（主进程与渲染层共用同一形状，避免两处各写一份） */
export type DesktopConnection = {
  /** 服务注册文件是否读得到（读到即本机身份证明）；读不到时渲染层显示「未找到服务」 */
  registered: boolean;
  /** 服务注册文件路径，供不可用态提示定位 */
  servicePath: string;
};
