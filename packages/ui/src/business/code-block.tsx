/**
 * 代码块：整块交给高亮器，并在右上角提供复制。
 *
 * 复制的源文本用组件手里这份 `code`，不从 DOM 取——高亮后 DOM 里是拆开的 span，取回来会掺进换行与空白。
 * 复制按钮与图块、表格、图片的悬浮按钮同一口径：悬停或键盘聚焦时出现。
 */
import { useHighlightedLines } from "../hooks/use-highlighted-lines";
import { CopyAction } from "./copy-action";

export function CodeBlock({
  code,
  deferred,
  language,
}: {
  code: string;
  /** 该块仍在流式：先铺纯文本，写完再上色——每个 chunk 都重算会让它反复退回纯文本 */
  deferred: boolean;
  language: string | null;
}) {
  // hook 认 `undefined` 作「这次不高亮」，不必在组件里再分一次支
  const tokens = useHighlightedLines(deferred ? undefined : code, language);
  const lines = code.split("\n");

  return (
    <div className="group/code relative">
      <pre>
        <code>
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 代码行没有自然 id，行号即身份
            <div key={index} className="whitespace-pre">
              {tokens?.[index]?.map((token, tokenIndex) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同一行内的 token 按顺序排列，无自然 id
                  key={tokenIndex}
                  style={{ color: token.color }}
                >
                  {token.content}
                </span>
              )) ?? (line === "" ? " " : line)}
            </div>
          ))}
        </code>
      </pre>
      <CopyAction
        className="absolute top-2 right-2 bg-card/80 text-foreground opacity-0 backdrop-blur-sm transition group-hover/code:opacity-100 focus-visible:opacity-100"
        text={code}
      />
    </div>
  );
}
