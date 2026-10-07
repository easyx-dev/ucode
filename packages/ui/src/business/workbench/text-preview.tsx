/**
 * 文本预览：行号 + 等宽 + 横向滚动，配 shiki 语法高亮。
 *
 * 高亮是异步增强：未就绪（或在阈值之外）时先铺纯文本，到位后替换成着色片段，
 * 两者共用同一套行容器，因此不会跳到别处。大文件按 `PREVIEW_MAX_LINES` 截断渲染，
 * 只影响界面，不改服务端返回的内容。
 */
import { useTranslation } from "react-i18next";

import { useHighlightedLines } from "../../hooks/use-highlighted-lines";
import { languageOfPath } from "../../lib/shiki-languages";

/** 单次渲染的行数上限；超出后只铺前若干行并提示 */
const PREVIEW_MAX_LINES = 5_000;

/** 整行文本（无高亮或该行没有 token 时用） */
const plainLine = (text: string): string => (text === "" ? " " : text);

export function TextPreview({ path, text }: { path: string; text: string }) {
  const { t } = useTranslation();
  const tokens = useHighlightedLines(text, languageOfPath(path));
  const lines = text.split("\n");
  const truncated = lines.length > PREVIEW_MAX_LINES;
  const total = truncated ? PREVIEW_MAX_LINES : lines.length;

  return (
    <div className="py-2 font-mono text-xs leading-relaxed">
      {Array.from({ length: total }, (_, index) => {
        const parts = tokens?.[index];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 代码行没有自然 id，行号即身份
          <div key={index} className="flex whitespace-pre">
            <span className="sticky left-0 w-12 shrink-0 select-none bg-card pr-3 text-right text-muted-foreground/50">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              {parts && parts.length > 0
                ? parts.map((token, tokenIndex) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: 同一行内的 token 按顺序排列，无自然 id
                      key={tokenIndex}
                      style={{ color: token.color }}
                    >
                      {token.content}
                    </span>
                  ))
                : plainLine(lines[index] ?? "")}
            </span>
          </div>
        );
      })}
      {truncated ? (
        <p className="px-3 py-2 text-muted-foreground">
          {t("仅显示前 {{value}} 行", { value: PREVIEW_MAX_LINES })}
        </p>
      ) : null}
    </div>
  );
}
