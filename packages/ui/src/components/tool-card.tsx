import type { DisplayItem } from "@ucode/sdk";
import { type ReactNode, useState } from "react";
import { Markdown } from "./markdown.tsx";

/**
 * 工具调用卡片（ZCode 风格）：一行摘要 + 状态，点开看参数与输出。
 *
 * 状态来自与 toolResult 的配对：running（还没落盘结果）/ done / error。
 */

type ToolItem = Extract<DisplayItem, { kind: "tool" }>;

function toolSummary(item: ToolItem): string {
  const args = item.args as Record<string, unknown>;
  const path =
    typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : undefined;
  switch (item.toolName) {
    case "read":
    case "read_file":
      return path ?? "读取文件";
    case "write":
    case "write_file":
      return path ?? "写入文件";
    case "edit":
    case "edit_file":
      return path ?? "编辑文件";
    case "bash":
    case "shell":
      return typeof args.command === "string" ? args.command : "执行命令";
    case "grep":
    case "search":
      return typeof args.pattern === "string" ? args.pattern : "搜索";
    case "glob":
    case "find":
      return typeof args.pattern === "string" ? args.pattern : "查找文件";
    case "todo":
    case "todowrite":
      return "更新任务清单";
    default:
      return item.toolName;
  }
}

function toolIcon(toolName: string): string {
  if (/^(read|read_file)$/.test(toolName)) return "📄";
  if (/^(write|write_file|edit|edit_file|multiedit|apply_patch)$/.test(toolName)) return "✏️";
  if (/^(bash|shell|exec)$/.test(toolName)) return "❯";
  if (/^(grep|search|find|glob|ls|list)$/.test(toolName)) return "🔍";
  return "⚙";
}

/** 写入类工具：展开后直接给内容（ZCode 的 diff 视图留给编辑器集成，这里先给全文 + 结果）。 */
function ToolBody({ item }: { item: ToolItem }): ReactNode {
  const args = item.args as Record<string, unknown>;
  const content = typeof args.content === "string" ? args.content : undefined;
  const path =
    typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : undefined;
  return (
    <div className="space-y-2 px-3 pb-2.5">
      {Object.keys(item.args).length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-[var(--color-content-muted)]">参数</div>
          <pre className="overflow-x-auto rounded border border-[var(--color-border-subtle)] bg-[oklch(0.19_0.01_260)] p-2 font-[var(--font-mono)] text-[11px] leading-4">
            {JSON.stringify(item.args, null, 2)}
          </pre>
        </div>
      )}
      {content !== undefined && path !== undefined && (
        <div>
          <div className="mb-1 text-[11px] text-[var(--color-content-muted)]">{path}</div>
          <pre className="overflow-x-auto rounded border border-[var(--color-border-subtle)] bg-[oklch(0.19_0.01_260)] p-2 font-[var(--font-mono)] text-[11px] leading-4">
            {content}
          </pre>
        </div>
      )}
      {item.output !== "" && (
        <div>
          <div className="mb-1 text-[11px] text-[var(--color-content-muted)]">输出</div>
          <pre
            className={`max-h-64 overflow-auto whitespace-pre-wrap rounded border p-2 font-[var(--font-mono)] text-[11px] leading-4 ${
              item.status === "error"
                ? "border-[oklch(0.4_0.1_25)] text-[var(--color-danger)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-content)]"
            }`}
          >
            {item.output}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolCard({ item }: { item: ToolItem }): ReactNode {
  const [open, setOpen] = useState(item.status !== "done");
  const running = item.status === "running";
  const error = item.status === "error";
  const expandable = Object.keys(item.args).length > 0 || item.output !== "";

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
      <button
        type="button"
        onClick={() => expandable && setOpen((current) => !current)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] ${
          expandable ? "hover:bg-[var(--color-surface-overlay)]" : "cursor-default"
        }`}
      >
        <span>{toolIcon(item.toolName)}</span>
        <span className="font-medium">{item.toolName}</span>
        <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[var(--color-content-muted)]">
          {toolSummary(item)}
        </span>
        {running && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent)]">
            <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            运行中
          </span>
        )}
        {item.status === "done" && (
          <span className="text-[11px] text-[var(--color-content-muted)]">✓</span>
        )}
        {error && <span className="text-[11px] text-[var(--color-danger)]">出错</span>}
        {expandable && (
          <span className="text-[10px] text-[var(--color-content-muted)]">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && <ToolBody item={item} />}
    </div>
  );
}

/** 思考块：默认折叠（ZCode 同款交互——过程可见但不打扰）。 */
export function ThinkingBlock({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="text-[11px] text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
      >
        {open ? "▾" : "▸"} 思考过程
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 font-[var(--font-mono)] text-[11px] leading-4 text-[var(--color-content-muted)]">
          {text}
        </pre>
      )}
    </div>
  );
}

export { Markdown } from "./markdown.tsx";
