/**
 * 单次工具调用的展示：标题 + 入参摘要压在一行（32px 高），展开后才出输出 / diff。
 * 不自带底色与外框，直接铺在页面底色上，靠 hover 高亮说明可点。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderTree,
  Globe,
  type LucideIcon,
  Pencil,
  Search,
  Terminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../base/collapsible";
import { Spinner } from "../base/spinner";
import type { ToolEntry } from "../lib/chat-nodes";
import type { DiffLine } from "../lib/text-diff";
import { type ToolInput, type ToolKind, toolDiff, toolInputOf, toolKindOf } from "../lib/tool-view";

const KIND_ICON: Record<ToolKind, LucideIcon> = {
  read: FileText,
  write: FilePlus2,
  edit: Pencil,
  command: Terminal,
  search: Search,
  list: FolderTree,
  network: Globe,
  agent: Bot,
  other: Wrench,
};

/** 工具名的中文标题；上下文分组与聚合摘要也要用，故对外导出 */
export const toolTitleOf = (name: string, t: TFunction): string => {
  switch (name) {
    case "read":
      return t("读取");
    case "write":
      return t("写入");
    case "edit":
      return t("编辑");
    case "bash":
      return t("Shell");
    case "grep":
      return t("搜索");
    case "find":
      return t("查找");
    case "ls":
      return t("列出");
    case "webfetch":
      return t("获取网页");
    case "websearch":
      return t("联网搜索");
    case "subagent":
      return t("子智能体");
    case "question":
      return t("提问");
    case "tool_search":
      return t("搜索工具");
    case "remember":
    case "forget":
      return t("记忆");
    default:
      return t("工具");
  }
};

export function InputLabel({ input }: { input: ToolInput }) {
  switch (input.type) {
    case "path":
      return (
        <>
          <span className="truncate font-mono text-xs text-muted-foreground/70" title={input.path}>
            {input.path}
          </span>
          {input.range ? (
            <span className="shrink-0 font-mono text-xs text-warning">:{input.range}</span>
          ) : null}
        </>
      );
    case "command":
      return (
        <span className="truncate font-mono text-xs text-muted-foreground/70" title={input.command}>
          {input.command}
        </span>
      );
    case "pattern":
      return (
        <>
          <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
            /{input.pattern}/
          </span>
          {input.scope ? (
            <span className="truncate text-[11px] text-muted-foreground" title={input.scope}>
              {input.scope}
            </span>
          ) : null}
        </>
      );
    case "url":
      return (
        <span className="truncate font-mono text-xs text-muted-foreground/70" title={input.url}>
          {input.url}
        </span>
      );
    case "query":
      return (
        <span className="truncate font-mono text-xs text-muted-foreground/70" title={input.query}>
          {input.query}
        </span>
      );
    default:
      return null;
  }
}

function OutputView({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
        isError && "text-destructive",
      )}
    >
      {text}
    </pre>
  );
}

/** 单次展开最多渲染的 diff 行数；超出后折叠，避免大文件写入撑出上千个节点 */
const MAX_DIFF_LINES = 200;

function DiffView({ lines }: { lines: DiffLine[] }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  if (lines.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("（无内容）")}</p>;
  }

  const visible = showAll ? lines : lines.slice(0, MAX_DIFF_LINES);
  const hidden = lines.length - visible.length;
  // diff 行无自然 id：位置 + 类型组合即身份；先生成 key 再渲染，避免直接用数组下标作 key
  const rows = visible.map((line, position) => ({ key: `${position}:${line.type}`, line }));

  return (
    <>
      <div className="max-h-96 overflow-auto rounded-md bg-muted/50 py-1 font-mono text-xs leading-relaxed">
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              "flex px-2 whitespace-pre-wrap",
              row.line.type === "add" && "bg-success/10 text-success",
              row.line.type === "del" && "bg-destructive/10 text-destructive",
              row.line.type === "ctx" && "text-muted-foreground",
            )}
          >
            <span className="w-3 shrink-0 select-none" aria-hidden>
              {row.line.type === "add" ? "+" : row.line.type === "del" ? "-" : " "}
            </span>
            <span className="min-w-0 flex-1 break-words">{row.line.text || " "}</span>
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setShowAll(true)}
        >
          {t("显示全部 {{value}} 行", { value: lines.length })}
        </button>
      ) : null}
    </>
  );
}

type ToolCallProps = {
  entry: ToolEntry;
  /** 追加在输出下方的内容（如子智能体内联进度） */
  children?: ReactNode;
};

export function ToolCall({ entry, children }: ToolCallProps) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[toolKindOf(entry.name)];
  const input = toolInputOf(entry.name, entry.args);
  const args = useMemo(
    () => (typeof entry.args === "object" && entry.args !== null ? entry.args : null),
    [entry.args],
  );
  const showArgs = input.type === "none" && args !== null && Object.keys(args).length > 0;
  const diff = useMemo(() => toolDiff(entry.name, entry.args), [entry.name, entry.args]);
  const output = (entry.result ?? "").trimEnd();

  // 一律默认折叠：失败与执行中由状态图标提示，要不要看细节由用户决定
  const [open, setOpen] = useState(false);

  const hasBody = diff !== null || showArgs || output !== "" || Boolean(children);
  const statusLabel = entry.running ? t("执行中") : entry.isError ? t("失败") : t("完成");

  return (
    <Collapsible className="group/tool" open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex h-8 w-full items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs text-muted-foreground">{toolTitleOf(entry.name, t)}</span>
        <span className="flex min-w-0 shrink items-center gap-1.5">
          <InputLabel input={input} />
        </span>
        <span
          className="flex shrink-0 items-center"
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        >
          {entry.running ? (
            <Spinner className="text-muted-foreground" />
          ) : entry.isError ? (
            <TriangleAlert className="size-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="size-3.5 text-muted-foreground/60" />
          )}
        </span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover/tool:opacity-100 group-data-[state=open]:opacity-100",
            open && "rotate-90",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 py-1 pr-1.5 pl-6">
          {diff !== null ? <DiffView lines={diff} /> : null}
          {showArgs ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {JSON.stringify(args, null, 2)}
            </pre>
          ) : null}
          {diff === null && output !== "" ? (
            <OutputView text={output} isError={entry.isError} />
          ) : null}
          {!hasBody && !entry.running ? (
            <p className="text-xs text-muted-foreground">{t("（无输出）")}</p>
          ) : null}
          {!hasBody && entry.running ? (
            <p className="text-xs text-muted-foreground">{t("执行中")}</p>
          ) : null}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
