import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/**
 * Markdown 渲染（ZCode 风格）。
 *
 * 助手消息是 markdown；代码块带语言标签与复制按钮（highlight.js 做语法高亮，
 * 主题由宿主引入 `highlight.js/styles/github-dark.css`）。
 */

function extractText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return extractText(props?.children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }): ReactNode {
  const first = Array.isArray(children) ? children[0] : children;
  const childProps =
    typeof first === "object" && first !== null && "props" in (first as Record<string, unknown>)
      ? ((first as { props: { className?: string; children?: ReactNode } }).props ?? {})
      : {};
  const language = /language-([\w-]+)/.exec(childProps.className ?? "")?.[1] ?? "text";
  const text = extractText(childProps.children);
  const [copied, setCopied] = useState(false);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-code)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-content-faint)]">
        <span className="font-[var(--font-mono)]">{language}</span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-content)]"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_500);
            });
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 text-[12px] leading-5">{children}</pre>
    </div>
  );
}

export function Markdown({ children }: { children: string }): ReactNode {
  return (
    <div className="min-w-0 break-words text-[13px] leading-6 text-[var(--color-content)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ children, className }) => {
            // 块级代码已在 pre 里包装；这里只管行内代码
            if (className?.includes("language-") || className?.includes("hljs")) {
              return (
                <code className={`${className ?? ""} font-[var(--font-mono)]`}>{children}</code>
              );
            }
            return (
              <code className="rounded bg-[var(--color-surface-overlay)] px-1 py-0.5 font-[var(--font-mono)] text-[12px] text-[var(--color-content)]">
                {children}
              </code>
            );
          },
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 text-[15px] font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1.5 mt-3 text-[13px] font-semibold first:mt-0">{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-[var(--color-border-subtle)] pl-3 text-[var(--color-content-muted)]">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--color-border-subtle)] px-2 py-1 align-top">
              {children}
            </td>
          ),
          hr: () => <hr className="my-3 border-[var(--color-border-subtle)]" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
