/** 输入区发出的结构化载荷：正文 + `@` 上下文引用 + 图片附件 */
import type { ContextRef, MessageImage } from "@ucode/contracts";

export type ComposerPayload = {
  /** 正文；命令 / 技能已还原为 `/name`、`/skill:name` */
  text: string;
  /** `@` 引用的文件 / 目录（绝对路径，限会话 cwd 内） */
  contexts: ContextRef[];
  /** 图片附件（base64 + mimeType） */
  images: MessageImage[];
  /** 图片附件的本地库 id，与 `images` 一一对应；用于发送失败时回填草稿 */
  attachmentIds: string[];
};

export const emptyPayload = (): ComposerPayload => ({
  text: "",
  contexts: [],
  images: [],
  attachmentIds: [],
});

/** 纯文本载荷（计划批准、plan 反馈、失败回填等场景） */
export const textPayload = (text: string): ComposerPayload => ({
  text,
  contexts: [],
  images: [],
  attachmentIds: [],
});

export const isPayloadEmpty = (payload: ComposerPayload): boolean =>
  payload.text.trim() === "" && payload.contexts.length === 0 && payload.images.length === 0;
