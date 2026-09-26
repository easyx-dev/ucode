/**
 * 协议 C 的版本。
 *
 * 版本双向校验、从不静默降级（ADR-012）：双方都必须校验对方版本，不支持则显式拒绝。
 * 新增可选能力走能力协商，不升版本号；只有改变既有消息语义才升版本号。
 */
export const PROTOCOL_VERSION = 1;

/** 本实现能读懂的最低协议版本。读到更低版本按"不兼容"显式拒绝，不做尽力而为的解析。 */
export const MIN_READABLE_PROTOCOL_VERSION = 1;

export function isVersionSupported(version: number): boolean {
  return version >= MIN_READABLE_PROTOCOL_VERSION && version <= PROTOCOL_VERSION;
}
