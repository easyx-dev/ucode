/**
 * 隧道协议的固定值。
 *
 * 隧道是 hub 与 UCode 中继客户端之间的**字节级**反向代理：hub 把公网请求序列化进来，
 * UCode 客户端用本地 `serviceToken` 转发给本机服务，再把响应原样回传。
 * 这些限额两端共用：发送方按 `MAX_FRAME_PAYLOAD` 切块，接收方按同一值拒收超大帧。
 */

/**
 * 协议版本：两端不一致时拒绝握手（不兼容就让客户端升级，不做降级兼容）。
 *
 * v2：请求帧多了 `upgrade`（把一条流转成 WebSocket），并新增 `close` 帧回传关闭码。
 * v3：`headers` 支持同名多值（数组），线上错误码收成统一词表并被 `error` 帧约束为枚举，
 *     并发上限只由中继侧执行。
 */
export const PROTOCOL_VERSION = 3;

/** 数据帧头部字节数：1 字节类型 + 4 字节流号 + 4 字节载荷长度（大端） */
export const FRAME_HEADER_BYTES = 9;

/** 单个数据帧载荷上限（1MB）：再大就切块，避免一帧吃掉对端内存 */
export const MAX_FRAME_PAYLOAD = 1024 * 1024;

/**
 * 单个隧道上同时在飞的请求上限，**只由中继侧执行**：超限由 ingress 回 429（`tunnel_busy`）。
 * 设备侧不再设第二道闸——两套口径会让「超限」在两端表现成不同的状态码。
 */
export const MAX_CONCURRENT_STREAMS = 64;

/**
 * 一条升级流在与本机 WebSocket 建连之前能缓冲的上行字节上限：
 * 超过即断开该流——浏览器连发而设备侧连不上时，不能把它攒在内存里。
 */
export const MAX_UPGRADE_BUFFER_BYTES = 1024 * 1024;

/** 请求头上限（序列化后的字节数）：防止畸形请求把一条隧道撑爆 */
export const MAX_HEADER_BYTES = 32 * 1024;

/** 隧道心跳间隔与判死阈值（应用层 ping/pong，与 WS 协议级 ping 并行） */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const HEARTBEAT_TIMEOUT_MS = 90 * 1000;

/** 控制帧类型（`streamId` 恒为 0；数据帧的流号从 1 起） */
export const CONTROL_STREAM_ID = 0;

/** 单条隧道的握手路径：hub 侧固定挂在这里 */
export const TUNNEL_PATH = "/api/v1/tunnel";

/**
 * 隧道握手的凭据头：`Authorization: Bearer <tunnelTicket>`。
 *
 * 票据不是长期设备令牌——由中继控制面用设备令牌换发（`POST /api/v1/devices/tunnel-ticket`），
 * 短时有效。这样数据面只验签、不查库，吊销由控制面在签票时判定。
 * 放头里而不是 URL，避免凭据进访问日志。
 */
export const DEVICE_AUTH_HEADER = "authorization";

/**
 * 隧道里的错误码：两端共用一份词表，`error` 帧与 `reject` 帧的 `code` 都取自这里。
 *
 * 汇成一处的意义是「hub 会说哪些码」可被枚举：中继据此归类（回哪个 HTTP 状态）、
 * 客户端据此决定重试还是停手，都不必靠字符串猜。
 */
export const TUNNEL_ERROR_CODES = {
  /** 目标设备没有在线隧道 */
  deviceOffline: "device_offline",
  /** 设备令牌无效或已吊销 */
  deviceUnauthorized: "device_unauthorized",
  /** 同一设备的新隧道接管了旧连接（旧连接收到 `reject`） */
  deviceTakenOver: "device_taken_over",
  /** 请求超过该隧道的并发上限（唯一由中继侧判定） */
  tunnelBusy: "tunnel_busy",
  /** 协议版本不匹配 */
  protocolMismatch: "protocol_mismatch",
  /** 隧道返回了 2xx 之前的状态码（中继侧判定，不来自帧） */
  invalidStatus: "invalid_status",
  /** 帧里的路径或方法拼不成合法请求 */
  invalidRequest: "invalid_request",
  /** 读不到本机服务地址或凭证 */
  localUnavailable: "local_unavailable",
  /** 连不上本机服务 */
  localUnreachable: "local_unreachable",
  /** 本机服务在响应中途出错或中断 */
  localFailed: "local_failed",
  /** 本机以非 101 的 HTTP 响应拒绝了 WebSocket 升级（`close` 帧带映射后的关闭码） */
  localRejected: "local_rejected",
  /** 公网侧已断开，对应上游请求随之取消 */
  aborted: "aborted",
} as const;

export type TunnelErrorCode = (typeof TUNNEL_ERROR_CODES)[keyof typeof TUNNEL_ERROR_CODES];

/** 词表的全部取值：zod 枚举与拒收判定共用，新增码只改上面一处 */
export const TUNNEL_ERROR_CODE_VALUES = Object.values(TUNNEL_ERROR_CODES) as [
  TunnelErrorCode,
  ...TunnelErrorCode[],
];
