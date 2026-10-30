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
 * v1 只承载普通 HTTP 请求 / 响应，装不下 WebSocket 的双向与关闭语义（终端、桌面端浏览器面板）。
 */
export const PROTOCOL_VERSION = 2;

/** 数据帧头部字节数：1 字节类型 + 4 字节流号 + 4 字节载荷长度（大端） */
export const FRAME_HEADER_BYTES = 9;

/** 单个数据帧载荷上限（1MB）：再大就切块，避免一帧吃掉对端内存 */
export const MAX_FRAME_PAYLOAD = 1024 * 1024;

/** 单个隧道上同时在飞的请求上限：超限由 hub 回 429，而不是把内存排满 */
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
 * 设备隧道凭据的请求头：握手时 `Authorization: Bearer <deviceToken>`。
 * 放头里而不是 URL，避免令牌进访问日志。
 */
export const DEVICE_AUTH_HEADER = "authorization";

/** 隧道断线时 hub 回给 ingress 的错误码（客户端重连后自然恢复） */
export const TUNNEL_ERROR_CODES = {
  /** 目标设备没有在线隧道 */
  deviceOffline: "device_offline",
  /** 设备令牌无效或已吊销 */
  deviceUnauthorized: "device_unauthorized",
  /** 请求超过该隧道的并发上限 */
  tunnelBusy: "tunnel_busy",
  /** 协议版本不匹配 */
  protocolMismatch: "protocol_mismatch",
} as const;

export type TunnelErrorCode = (typeof TUNNEL_ERROR_CODES)[keyof typeof TUNNEL_ERROR_CODES];
