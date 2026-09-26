/**
 * 数据层的可诊断错误。
 *
 * 拒绝启动是**显式**行为（spec §3.4）：权限不满足、危险文件系统、版本过高、路径逃逸
 * 都必须拒绝并给出原因，不静默修正、不尽力而为。
 */
export const DATA_LAYER_ERROR_CODES = {
  permission_denied: "数据层目录权限不满足要求（只应对本人可读写）。",
  dangerous_filesystem: "数据层位于网络文件系统或被云同步的目录，锁与变更通知都不可靠。",
  protocol_version_ahead: "数据层协议版本高于本实现，拒绝启动（不做尽力而为的解析）。",
  data_layer_broken: "数据层元数据损坏（如版本文件格式非法）。",
  path_escape: "由标识或项目路径派生的路径逃逸出了数据层目录。",
  session_not_found: "会话不存在。",
  session_broken: "会话文件损坏到无法安全使用。",
  owner_conflict: "该会话已被另一个实例持有（owner 语义）。",
  owner_not_held: "本实例没有持有该会话的写权限。",
} as const;

export type DataLayerErrorCode = keyof typeof DATA_LAYER_ERROR_CODES;

export class DataLayerError extends Error {
  readonly code: DataLayerErrorCode;
  readonly details: unknown;

  constructor(code: DataLayerErrorCode, message?: string, details?: unknown) {
    super(message ?? DATA_LAYER_ERROR_CODES[code]);
    this.name = "DataLayerError";
    this.code = code;
    this.details = details;
  }
}

export function isDataLayerError(error: unknown): error is DataLayerError {
  return error instanceof DataLayerError;
}

/** 断言工具：失败必须是数据层错误（一致性套件按 code 断言，不靠错误文案）。 */
export function assertDataLayer(
  condition: unknown,
  code: DataLayerErrorCode,
  message?: string,
): void {
  if (!condition) throw new DataLayerError(code, message);
}
