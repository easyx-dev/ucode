/**
 * 协议 D 的版本。
 *
 * 数据层里存在**两个独立版本概念**（spec §3.11），不要混淆或合并：
 * - 数据层协议版本（本文件）——协议 D 本身的版本，由我们演进；
 * - 会话记录格式版本（entries.ts 的 CURRENT_SESSION_VERSION）——沿用 pi 的格式，由 pi 演进。
 *
 * 合并的话，"升一次协议版本"会变成"必须重写所有会话文件"，而重写会作废所有客户端的游标。
 */
export const DATA_LAYER_PROTOCOL_VERSION = 1;

/** 本实现能读懂的最低数据层协议版本。 */
export const DATA_LAYER_MIN_READABLE_VERSION = 1;

export type DataLayerVersion = {
  protocolVersion: number;
  minReadableVersion: number;
};

export const CURRENT_DATA_LAYER_VERSION: DataLayerVersion = {
  protocolVersion: DATA_LAYER_PROTOCOL_VERSION,
  minReadableVersion: DATA_LAYER_MIN_READABLE_VERSION,
};

/**
 * 版本前向拒绝（spec §3.4 第 6 条）：读到高于自身的数据层版本必须拒绝启动，
 * 禁止"尽力而为"地解析——那是数据损坏类事故的经典成因。
 */
export function isDataLayerVersionReadable(version: DataLayerVersion): boolean {
  return version.protocolVersion <= DATA_LAYER_PROTOCOL_VERSION;
}

export function parseDataLayerVersion(raw: unknown): DataLayerVersion | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const protocolVersion = candidate.protocolVersion;
  const minReadableVersion = candidate.minReadableVersion;
  if (typeof protocolVersion !== "number" || typeof minReadableVersion !== "number") {
    return undefined;
  }
  return { protocolVersion, minReadableVersion };
}
