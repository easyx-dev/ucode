/**
 * 粘贴文本的方言判定：这段字里有没有会真的生效的记号。
 *
 * 用它决定「粘贴要不要转义」。不做启发式猜（`@` 到处都是，见 `@用户名`、邮箱），而是拿真正的解析器
 * 扫一遍：容器围栏、能成形的引用与附件、以及写了 `attachment:` 但类型 / id 不合法的那些。
 * 代码区内的记号不算——解析器本来就不认它们。
 */
import { scanContainers } from "./containers.ts";
import { scanInline } from "./inline.ts";
import { nonParsedIntervals, parseMarkdownTree } from "./regions.ts";

export const hasDialectSyntax = (
  text: string,
  /** 引用锚点的 scheme 表：表内的 `@scheme:…` 不算「会生效的方言记号」，粘贴时不必转义 */
  mentions: readonly string[] = [],
): boolean => {
  const skipped = nonParsedIntervals(parseMarkdownTree(text));
  if (scanContainers(text, skipped).length > 0) return true;

  const inline = scanInline(text, { from: 0, to: text.length }, skipped, mentions);
  return (
    inline.invalidAttachments.length > 0 || inline.tokens.some((token) => token.kind !== "text")
  );
};
