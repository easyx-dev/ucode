/**
 * 上下文压缩的分隔行：标出「此前的历史已被摘要替代」。
 *
 * 摘要默认收起——它是给模型继续工作的结构化笔记，不是这一轮的回答，展开才回看被替代掉的那段历史。
 */
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CompactionDivider({ summary }: { summary: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hasSummary = summary.trim().length > 0;

  const label = (
    <span className="flex shrink-0 items-center gap-1">
      {t("会话已压缩")}
      {hasSummary ? (
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      ) : null}
    </span>
  );

  return (
    <div className="text-xs text-muted-foreground">
      {hasSummary ? (
        <button
          type="button"
          className="group flex w-full items-center gap-3 focus-visible:outline-none"
          title={open ? t("收起摘要") : t("查看摘要")}
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className="h-px flex-1 bg-border" />
          <span className="group-hover:text-foreground">{label}</span>
          <span className="h-px flex-1 bg-border" />
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          {label}
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {hasSummary && open ? (
        <div className="md-content mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <Markdown remarkPlugins={[remarkGfm]}>{summary}</Markdown>
        </div>
      ) : null}
    </div>
  );
}
