/** service 域的响应模型：监听地址配置与是否需重启生效 */

/** 当前服务监听配置 */
export type ServiceInfoResponse = {
  /** 注册文件里配置的监听地址 */
  host: string;
  /** 是否需要重启服务才能让配置生效（进程当前实际绑定地址与配置不同） */
  restartRequired: boolean;
};

/** 修改监听地址的回执 */
export type ServiceHostResponse = {
  host: string;
  restartRequired: boolean;
};
