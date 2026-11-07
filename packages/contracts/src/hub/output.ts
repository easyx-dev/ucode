/** hub 域的响应模型：中继接入状态（状态查询、登录与登出回的是同一份结构） */

/**
 * 隧道所处阶段：
 * - `idle`：未启用或缺少地址 / 设备令牌，没有可连的东西；
 * - `connecting`：正在连或正在握手；
 * - `ready`：已握手完成，中继可以往这条隧道上开流；
 * - `reconnecting`：退避等待下一次尝试；
 * - `halted`：中继明确拒绝（凭据无效、协议不兼容），重试无用，等配置变化或进程重启。
 */
export type HubRuntimePhase = "idle" | "connecting" | "ready" | "reconnecting" | "halted";

/** 隧道运行态：状态接口与界面据此显示「连没连上、上次为什么失败、还能不能自己恢复」 */
export type HubRuntimeView = {
  /** 隧道所处阶段 */
  phase: HubRuntimePhase;
  /** 本次上线时刻（ISO）；未连接为 null */
  connectedAt: string | null;
  /** 最近一次失败原因（中文，可直接展示）；已连上时为 null */
  lastError: string | null;
  /** 已发起的重连次数；连上后归零 */
  reconnectAttempt: number;
};

/** 中继接入状态：界面据此区分「未接入」（去填地址登录）与「已接入」（看隧道状态、可登出） */
export type HubStatusResponse = {
  /** 地址与设备令牌齐备，具备连隧道的条件 */
  configured: boolean;
  /** 中继服务地址（含部署预置的缺省值）；未配置为 null */
  url: string | null;
  /** 当前登录的中继账号；未登录为 null */
  username: string | null;
  /** 本机在中继上的设备标识；未登记为 null */
  deviceId: string | null;
  /** 登记设备时用的本机名（主机名） */
  deviceName: string | null;
  /** 当前是否持有隧道连接 */
  running: boolean;
  /** 隧道的连接态与最近一次失败原因 */
  runtime: HubRuntimeView;
};

/** 登录成功后的状态；等价于状态查询 */
export type HubLoginResponse = HubStatusResponse;

/** 登出（解绑本机）后的状态；等价于状态查询 */
export type HubLogoutResponse = HubStatusResponse;

/** 写入中继 provider 时与已有配置的关系 */
export type HubProviderOutcome =
  /** 配置里本来没有同 id 的 provider */
  | "created"
  /** 已有的那份端点也是这台中继，只是刷新了模型清单 */
  | "updated"
  /** 同 id 的 provider 指向别处（用户自己配的），这次把它换成了中继 */
  | "overwritten";

/** 把中继模型端点写成本机 provider 的结果：界面据此提示写入了多少模型、有没有覆盖同 id 的旧配置 */
export type HubProviderResponse = {
  /** 写入的 provider id（固定 `relay`） */
  providerId: string;
  /** 写入的端点根地址：`<中继地址>/v1`，对话与模型清单都在它下面 */
  baseUrl: string;
  /** 一并写入的模型 id 清单；中继没有可用模型时直接报错，所以至少一个 */
  models: string[];
  /** 本次写入与已有配置的关系 */
  outcome: HubProviderOutcome;
};
