/**
 * 粘贴不受信文本时的记号转义：让对方文本里的命令围栏、引用、附件语法一律按字面处理。
 *
 * 只转义会改变语义的那几处（`\` 自身、行首容器围栏、`@` 引用、`![` 附件），不把整段文本变成
 * 反斜杠海洋——转义后的文本仍是可读的 Markdown。
 */

/** 行首的三个以上冒号（容器围栏的开头） */
const LINE_START_FENCE = /(^|\n)(:{3,})/g;

export const escapeDialect = (text: string): string =>
  text
    .replaceAll("\\", "\\\\")
    .replaceAll("@", "\\@")
    .replaceAll("![", "\\![")
    .replace(LINE_START_FENCE, "$1\\$2");
