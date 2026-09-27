/**
 * 服务存储的可诊断错误。
 *
 * 拒绝启动是**显式**行为：权限不满足、危险文件系统、路径逃逸都必须拒绝并给出原因，
 * 不静默修正、不尽力而为。
 */
export const STORAGE_ERROR_CODES = {
  permission_denied: "数据根权限不满足要求（只应对本人可读写）。",
  dangerous_filesystem: "数据根位于网络文件系统或被云同步的目录，锁与变更通知都不可靠。",
  storage_broken: "服务存储的元数据损坏。",
  path_escape: "由标识或项目路径派生的路径逃逸出了数据根。",
  session_not_found: "会话不存在。",
  session_broken: "会话文件损坏到无法安全使用。",
} as const;

export type StorageErrorCode = keyof typeof STORAGE_ERROR_CODES;

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly details: unknown;

  constructor(code: StorageErrorCode, message?: string, details?: unknown) {
    super(message ?? STORAGE_ERROR_CODES[code]);
    this.name = "StorageError";
    this.code = code;
    this.details = details;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}
