/**
 * 数据帧：走二进制帧的请求体 / 响应体分块。
 *
 * 布局 `[kind:1][streamId:4][length:4][payload]`（全部大端）：二进制而不是 base64 是关键——
 * 事件流是高频小帧，base64 会白涨三分之一流量，且以后改协议更贵。
 * 切块与拒收共用 `MAX_FRAME_PAYLOAD`，两端行为对称。
 */
import { FRAME_HEADER_BYTES, MAX_FRAME_PAYLOAD } from "./constants";

/**
 * 帧类型：请求方向由 hub 发往客户端，响应方向由客户端发回 hub。
 *
 * `Text` 变体表示这一块的语义是 WebSocket 文本帧（内容是 UTF-8）：终端的上行约定就是文本帧，
 * 二进制帧会被它忽略；下行也要保持原样，否则界面侧拿到的类型就变了。
 */
export const DATA_FRAME_KINDS = {
  requestBody: 0,
  responseBody: 1,
  requestText: 2,
  responseText: 3,
} as const;

export type DataFrameKind = (typeof DATA_FRAME_KINDS)[keyof typeof DATA_FRAME_KINDS];

export type DataFrame = {
  kind: DataFrameKind;
  /** 流号从 1 起：0 留给控制帧，收到 0 一律判为非法 */
  streamId: number;
  payload: Uint8Array;
};

const KIND_VALUES: number[] = Object.values(DATA_FRAME_KINDS);

const isDataFrameKind = (value: number): value is DataFrameKind => KIND_VALUES.includes(value);

export const encodeDataFrame = (frame: DataFrame): Uint8Array => {
  if (frame.payload.byteLength > MAX_FRAME_PAYLOAD) {
    throw new Error(`数据帧载荷超过上限（${MAX_FRAME_PAYLOAD} 字节），请先切块`);
  }
  const buffer = new Uint8Array(FRAME_HEADER_BYTES + frame.payload.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint8(0, frame.kind);
  view.setUint32(1, frame.streamId);
  view.setUint32(5, frame.payload.byteLength);
  buffer.set(frame.payload, FRAME_HEADER_BYTES);
  return buffer;
};

/** 解码：头部不足、流号非法、类型未知、长度与载荷不符都返回 null */
export const decodeDataFrame = (bytes: Uint8Array): DataFrame | null => {
  if (bytes.byteLength < FRAME_HEADER_BYTES) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = view.getUint8(0);
  const streamId = view.getUint32(1);
  const length = view.getUint32(5);

  if (!isDataFrameKind(kind)) return null;
  if (streamId <= 0) return null;
  if (length > MAX_FRAME_PAYLOAD) return null;
  if (bytes.byteLength < FRAME_HEADER_BYTES + length) return null;

  return {
    kind,
    streamId,
    payload: bytes.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length),
  };
};

/** 按上限切块：空载荷返回空数组，调用方据此不发数据帧 */
export const chunkPayload = (
  payload: Uint8Array,
  max: number = MAX_FRAME_PAYLOAD,
): Uint8Array[] => {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < payload.byteLength; offset += max) {
    chunks.push(payload.subarray(offset, Math.min(offset + max, payload.byteLength)));
  }
  return chunks;
};
