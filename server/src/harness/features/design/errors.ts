/**
 * 设计画布的失败口径：一份错误同时服务两个消费方，所以带上机器可读的 `code`。
 *
 * - 工具侧：`message` 直接进模型看到的工具结果（中文、可操作，说清下一步该干什么）；
 * - 路由侧：按 `code` 折成 `ERROR_CODES` 里的错误码与 HTTP 状态（见 `routes/design`）。
 *
 * 不直接用 `AppError`：那属于 `platform/response`（接口层），而这两个消费方里有一个是模型工具，
 * 工具的失败不该长得像一次 HTTP 失败。
 */

/** 设计画布的失败类别：路由据此挑错误码，工具只看 `message` 与 `hint` */
export type DesignErrorCode =
  /** 文档里没有这一页 / 这个节点 */
  | "not_found"
  /** 引用锚点指向别的会话、别的页，或已删节点 */
  | "anchor_mismatch"
  /** 入参不成立（缺必填项、类型不对、目标不是文本节点这类） */
  | "invalid_input"
  /** 触到上限（节点数） */
  | "limit_exceeded"
  /** 落盘失败（权限、只读、空间不足） */
  | "io_failed";

export class DesignError extends Error {
  readonly code: DesignErrorCode;
  /** 可操作的下一步，工具结果里跟在正文后 */
  readonly hint?: string;

  constructor(code: DesignErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "DesignError";
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

export const designError = (code: DesignErrorCode, message: string, hint?: string): DesignError =>
  new DesignError(code, message, hint);

export const isDesignError = (value: unknown): value is DesignError => value instanceof DesignError;
