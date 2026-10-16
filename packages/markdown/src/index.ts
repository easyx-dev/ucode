/**
 * `@ucode/markdown`：UCode 方言（对外语法）、编辑器文档与会话条目三者之间的文本协议。
 *
 * 三层各有一份表示，本包负责它们之间的转换：
 * - 方言文本（用户与外部工具写的那份）：`parseDialect` / `renderDialect` / `escapeDialect` / `hasDialectSyntax`
 * - 编辑器文档（Tiptap 的节点 JSON）：`docToDialect` / `doc-nodes` 的构造与还原 / `entryToDoc`
 * - 会话条目（服务端拼的展开块 + 位置标记）：`parseEntryText` / `userMessageText` / `relativizeContextRefs`
 *
 * 投递层（模型看到的 `<command>` / `<skill>` / `<context>` 块）仍由服务端拼装，本包不碰。
 * 纯函数、无 IO、无 React / DOM：web、桌面端、TUI 与服务端都能用同一份规则。
 */

export type { ContainerFence } from "./containers.ts";
export { scanContainers } from "./containers.ts";
export type { MentionKind, PageElementContext } from "./doc-nodes.ts";
export {
  appendNodesToDoc,
  appendTextToDoc,
  attachmentNode,
  attachmentOrdinalInDoc,
  commandNode,
  contextNode,
  isDocEmpty,
  PAGE_ELEMENT_NODE,
  pageElementNode,
  textToDoc,
} from "./doc-nodes.ts";
export type { DocNode, DocToDialectOptions } from "./document.ts";
export {
  docToDialect,
  isDialectAttachmentKind,
  schemeKindFromName,
  schemeKindOfMime,
} from "./document.ts";
export type {
  AttachmentChip,
  CommandChip,
  EntrySegment,
  MarkedPayload,
  ParsedEntry,
  SkillChip,
} from "./entry.ts";
export {
  contextMarker,
  parseEntryText,
  relativizeContextRefs,
  userMessageText,
  visibleTextOf,
} from "./entry.ts";
export { entryToDoc } from "./entry-to-doc.ts";
export { escapeDialect } from "./escape.ts";
export { parseDialect } from "./parse.ts";
export { baseName, toRelativePath } from "./path.ts";
export { renderDialect } from "./render.ts";
export { hasDialectSyntax } from "./scan.ts";
export type {
  DialectAttachmentKind,
  DialectAttachmentView,
  DialectCommand,
  DialectDiagnostic,
  DialectDocument,
  DialectSkill,
  InvocationCandidates,
} from "./types.ts";
export { DIALECT_ATTACHMENT_KINDS, isBlockingDiagnostic } from "./types.ts";
