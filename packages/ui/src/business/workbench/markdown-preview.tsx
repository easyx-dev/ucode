/**
 * Markdown 预览：复用对话区的渲染链（react-markdown + remark-gfm），代码块走同一个高亮器。
 *
 * md 预览是「读文档」而不是「读源码」，所以正文按文档排版，只有 fenced code 才进 shiki。
 */
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useHighlightedLines } from "../../hooks/use-highlighted-lines";

/** `language-ts` → `ts`；没有语言标注时不高亮 */
const languageOfClass = (className: unknown): string | null => {
  if (typeof className !== "string") return null;
  const match = /language-([\w-]+)/.exec(className);
  return match?.[1] ?? null;
};

/** fenced code：整块交给高亮器，token 到位前先显示原文 */
function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const tokens = useHighlightedLines(code, language);
  const lines = code.replace(/\n$/, "").split("\n");

  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
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
  );
}

/** react-markdown 的 `code` 渲染器：区分行内代码与代码块 */
const renderCode = ({ className, children }: { className?: string; children?: ReactNode }) => {
  const language = languageOfClass(className);
  const content = String(children ?? "").replace(/\n$/, "");
  // 没有语言标注且内容只有一行时按行内代码处理
  if (!className && !content.includes("\n")) {
    return <code>{children}</code>;
  }
  return <CodeBlock code={content} language={language} />;
};

export function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="px-4 py-3">
      <div className="md-content">
        <Markdown remarkPlugins={[remarkGfm]} components={{ code: renderCode }}>
          {text}
        </Markdown>
      </div>
    </div>
  );
}
