/**
 * 「排队中」条带的数据：生成中发出去的输入在被送出之前没有会话条目，
 * 只在服务端内存队列里（见 `MessageListResponse.queued`），所以客户端按自己发出去的那份载荷记一行。
 *
 * 记的是**载荷摘要 + 编辑器文档**：摘要在条带上显示，文档留给「撤回」把内容原样还回输入框
 * （附件芯片与引用都只在文档里，载荷只有附件 id）。
 */
import type { DocNode } from "@ucode/markdown";
import type { PromptPayload } from "@ucode/sdk";

export type QueuedPrompt = {
  /** 本地序号，只用于列表 key */
  id: string;
  /** 一行摘要：命令 → 技能 → 命令参数 → 正文 */
  label: string;
  /** 发送时那份编辑器文档，撤回时按它回填 */
  doc: DocNode;
};

/** 条带上那一行摘要：与发送时输入框里看到的一致（命令名在前，参数随后） */
export const queuedLabelOf = (payload: PromptPayload): string =>
  [
    payload.command ? `/${payload.command.name}` : "",
    ...(payload.skills ?? []).map((skill) => `/skill:${skill.name}`),
    payload.command?.args ?? "",
    payload.text,
  ]
    .filter((part) => part.trim().length > 0)
    .join(" ");

export const queuedPromptOf = (id: string, payload: PromptPayload, doc: DocNode): QueuedPrompt => ({
  id,
  label: queuedLabelOf(payload),
  doc,
});

/**
 * 撤回时把排队那几条（以及输入框里已有的草稿）拼成一份文档：段与段之间留一个空段落，
 * 读起来就是几条独立的消息。都是空文档时返回 null（调用方不写草稿）。
 */
export const joinQueuedDocs = (docs: readonly DocNode[]): DocNode | null => {
  const paragraphs: DocNode[] = [];
  for (const doc of docs) {
    const content = doc.content ?? [];
    if (content.length === 0) continue;
    if (paragraphs.length > 0) paragraphs.push({ type: "paragraph" });
    paragraphs.push(...content);
  }
  return paragraphs.length > 0 ? { type: "doc", content: paragraphs } : null;
};
