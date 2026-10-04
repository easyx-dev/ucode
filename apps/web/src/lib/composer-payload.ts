/** 输入区发出的结构化载荷：正文 + `@` 上下文引用 + 附件；与 SDK 的 PromptPayload 同形，直接复用避免漂移 */
import type { PromptPayload } from "@ucode/sdk";

export type ComposerPayload = PromptPayload;

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
