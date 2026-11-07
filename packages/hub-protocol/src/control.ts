/**
 * 控制帧：走文本帧的 JSON，两端共用同一份 zod 校验。
 *
 * 流号（`id`）由 hub 分配、只增不复用；`hello` / `welcome` / `reject` 是握手三件套，
 * 其余帧都带 `id` 指向某条在飞的请求。数据帧不带 `id` 之外的信息（见 `frames.ts`）。
 */
import { z } from "zod";

import { TUNNEL_ERROR_CODE_VALUES } from "./constants";

const streamIdSchema = z.number().int().positive();

/**
 * 头的值：同名多值时是数组，单值时是字符串。
 *
 * 多值不是可选优化——`set-cookie` 按 RFC 不能逗号合并（`Expires` 自带逗号），
 * 压成一条会让浏览器把多条 cookie 当一条并把属性吞掉。
 */
export type HeaderValue = string | string[];

/** 一条消息的头表：键名保持发送方原样的大小写（转发侧按小写判定） */
export type HeaderMap = Record<string, HeaderValue>;

export const headerMapSchema = z.record(
  z.string().min(1),
  z.union([z.string(), z.array(z.string())]),
);

/** 头表的序列化字节数：两端用同一口径判定 `MAX_HEADER_BYTES` */
export const headerBytes = (headers: HeaderMap): number =>
  new TextEncoder().encode(JSON.stringify(headers)).byteLength;

/** 客户端首帧：声明协议版本与自身信息 */
export const helloFrameSchema = z.object({
  t: z.literal("hello"),
  protocol: z.number().int(),
  clientVersion: z.string().max(50).optional(),
  deviceName: z.string().max(100).optional(),
  platform: z.string().max(50).optional(),
});

/** hub 对握手的接受应答 */
export const welcomeFrameSchema = z.object({
  t: z.literal("welcome"),
  protocol: z.number().int(),
  deviceId: z.string().min(1),
  serverTime: z.string().min(1),
});

/** hub 拒绝握手（版本不匹配、设备未登记、被接管等） */
export const rejectFrameSchema = z.object({
  t: z.literal("reject"),
  code: z.enum(TUNNEL_ERROR_CODE_VALUES),
  message: z.string(),
});

/** hub → 客户端：一条待转发的请求（请求体随后的数据帧按 `id` 关联） */
export const requestFrameSchema = z.object({
  t: z.literal("request"),
  id: streamIdSchema,
  method: z.string().min(1).max(16),
  /** 路径含查询串（ingress 的原文） */
  path: z.string().min(1).max(4096),
  headers: headerMapSchema,
  hasBody: z.boolean(),
  /**
   * 要求把这条流转成 WebSocket：为真时双方不再按「请求体 / 响应体」分方向，
   * 而是各自持续发自己方向的数据帧，直到某一方发 `close`。
   */
  upgrade: z.boolean().optional(),
});

/** hub → 客户端：请求体发完 */
export const requestEndFrameSchema = z.object({ t: z.literal("requestEnd"), id: streamIdSchema });

/** hub → 客户端：公网侧已断开，不必再回包 */
export const abortFrameSchema = z.object({
  t: z.literal("abort"),
  id: streamIdSchema,
  reason: z.string().max(200).optional(),
});

/** 客户端 → hub：本机服务的响应头与状态码 */
export const responseFrameSchema = z.object({
  t: z.literal("response"),
  id: streamIdSchema,
  status: z.number().int().min(100).max(599),
  headers: headerMapSchema,
});

/** 客户端 → hub：响应体发完 */
export const responseEndFrameSchema = z.object({ t: z.literal("responseEnd"), id: streamIdSchema });

/**
 * 任一端：该流的失败（hub 侧转成 502 / 客户端侧记录后结束该流）。
 * `code` 取自协议词表——两端对同一份码表编程，不必猜对方的字符串。
 */
export const errorFrameSchema = z.object({
  t: z.literal("error"),
  id: streamIdSchema,
  code: z.enum(TUNNEL_ERROR_CODE_VALUES),
  message: z.string(),
});

/**
 * 一条已升级的 WebSocket 流被关闭，两端都可发。
 *
 * `code` 就是 WebSocket 关闭码：终端靠它区分「进程结束」「终端已不存在」「凭证失效」，
 * 这是 HTTP 状态码表达不了的语义，所以必须原样传到底。
 */
export const closeFrameSchema = z.object({
  t: z.literal("close"),
  id: streamIdSchema,
  code: z.number().int().min(1000).max(4999),
  reason: z.string().max(200).optional(),
});

export const pingFrameSchema = z.object({ t: z.literal("ping") });
export const pongFrameSchema = z.object({ t: z.literal("pong") });

export const controlFrameSchema = z.discriminatedUnion("t", [
  helloFrameSchema,
  welcomeFrameSchema,
  rejectFrameSchema,
  requestFrameSchema,
  requestEndFrameSchema,
  abortFrameSchema,
  responseFrameSchema,
  responseEndFrameSchema,
  errorFrameSchema,
  closeFrameSchema,
  pingFrameSchema,
  pongFrameSchema,
]);

export type ControlFrame = z.infer<typeof controlFrameSchema>;
export type ControlFrameType = ControlFrame["t"];
export type RequestFrame = z.infer<typeof requestFrameSchema>;
export type ResponseFrame = z.infer<typeof responseFrameSchema>;
export type CloseFrame = z.infer<typeof closeFrameSchema>;

/** 控制帧编码：文本帧里放 JSON */
export const encodeControlFrame = (frame: ControlFrame): string => JSON.stringify(frame);

/** 控制帧解码：认不出的结构一律返回 null（对端发垃圾不应让连接崩掉） */
export const decodeControlFrame = (text: string): ControlFrame | null => {
  try {
    const parsed = controlFrameSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
