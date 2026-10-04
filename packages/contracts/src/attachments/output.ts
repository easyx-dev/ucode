/** 附件接口的响应模型：上传后返回的引用视图，前端据此渲染与回传 id */
import type { AttachmentKind } from "../constants";

export type AttachmentView = {
  /** 内容 id：归一化（图片）或原始字节（其它）的 sha256，64 位小写 hex */
  id: string;
  mimeType: string;
  /** 原始文件名；未提供时为 null */
  name: string | null;
  /** 入库字节数（图片是归一化之后的大小） */
  size: number;
  /** 图片走 vision，其余只存与引用 */
  kind: AttachmentKind;
};

/** `POST /attachments` 的响应体（走标准封套） */
export type AttachmentUploadResponse = AttachmentView;
