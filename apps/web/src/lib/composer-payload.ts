/** 输入区发出的结构化载荷：正文 + `@` 上下文引用 + 附件 */
import type { AttachmentView, ContextRef } from "@ucode/contracts";

export type ComposerPayload = {
  /** 正文；命令 / 技能已还原为 `/name`、`/skill:name` */
  text: string;
  /** `@` 引用的文件 / 目录（绝对路径，限会话 cwd 内） */
  contexts: ContextRef[];
  /** 已上传到服务端的附件（发送时只取 id；其余字段供乐观渲染） */
  attachments: AttachmentView[];
};

export const emptyPayload = (): ComposerPayload => ({
  text: "",
  contexts: [],
  attachments: [],
});

/** 纯文本载荷（计划批准、plan 反馈、失败回填等场景） */
export const textPayload = (text: string): ComposerPayload => ({
  text,
  contexts: [],
  attachments: [],
});

export const isPayloadEmpty = (payload: ComposerPayload): boolean =>
  payload.text.trim() === "" && payload.contexts.length === 0 && payload.attachments.length === 0;
