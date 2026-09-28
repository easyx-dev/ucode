import type { DisplayItem } from "@ucode/sdk";
import { toDisplayItems } from "@ucode/sdk";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "../context.ts";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  ListIcon,
  PencilIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
} from "./icons.tsx";
import { Markdown } from "./markdown.tsx";
import { Button, Spinner } from "./primitives.tsx";
import { toolContentPreview, toolLabel, toolOutputPreview, toolSummary } from "./tool-format.ts";

/**
 * 转录：消息流（ZCode 的中间一列）。
 *
 * 排版口径：**助手不留角色标签**——正文本来就是"它说的话"，加个"助手"只是噪音；
 * 用户消息右对齐成一个气泡，一眼分得清谁说的。工具调用压成一行摘要，
 * 展开才看参数与输出（一次对话里工具调用往往比正文还多）。
 */

export function Transcript({ sessionId }: { sessionId: string }): ReactNode {
  const view = useAgentStore((store) => store.state.views[sessionId]);
  const resolveInteraction = useAgentStore((store) => store.resolveInteraction);
  const quoteIntoDraft = useAgentStore((store) => store.quoteIntoDraft);
  const items = useMemo(() => (view === undefined ? [] : toDisplayItems(view)), [view]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const tail = items.at(-1);

  useEffect(() => {
    const node = scroller.current;
    // 只在"本来就在底部"时跟随：用户翻上去读历史时不该被新内容拽回来。
    if (node === null || !atBottom) return;
    node.scrollTop = node.scrollHeight;
  }, [items.length, tail, atBottom]);

  const scrollToBottom = (): void => {
    const node = scroller.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
    setAtBottom(true);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
          setAtBottom(distance < 48);
        }}
        className="h-full overflow-y-auto"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-5">
          {items.length === 0 && (
            <p className="py-8 text-center text-xs text-[var(--color-content-faint)]">
              还没有消息。写下第一句，Enter 发送（Shift+Enter 换行）。
            </p>
          )}
          {items.map((item) => renderItem(item, sessionId, quoteIntoDraft, resolveInteraction))}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          title="回到最新"
          className="absolute bottom-3 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] text-[var(--color-content-muted)] shadow-lg transition-colors hover:text-[var(--color-content)]"
        >
          <ChevronDownIcon />
        </button>
      )}
    </div>
  );
}

type QuoteIntoDraft = (sessionId: string, text: string) => void;
type ResolveInteraction = (
  sessionId: string,
  interactionId: string,
  value: string | boolean | null,
) => void;

function renderItem(
  item: DisplayItem,
  sessionId: string,
  quoteIntoDraft: QuoteIntoDraft,
  resolveInteraction: ResolveInteraction,
): ReactNode {
  switch (item.kind) {
    case "user":
      return (
        <UserRow
          key={item.id}
          text={item.text}
          onQuote={() => quoteIntoDraft(sessionId, item.text)}
        />
      );
    case "assistant":
      return (
        <AssistantRow
          key={item.id}
          markdown={item.markdown}
          streaming={item.id === "__streaming__"}
          onQuote={() => quoteIntoDraft(sessionId, item.markdown)}
        />
      );
    case "tool":
      return <ToolRow key={item.id} item={item} />;
    case "thinking":
      return <ThinkingRow key={item.id} text={item.text} />;
    case "notice":
      return <NoticeRow key={item.id} text={item.text} />;
    case "compaction":
      return (
        <NoticeRow key={item.id} text={`上下文已压缩：${item.summary.slice(0, 200)}`} tone="warn" />
      );
    case "pending":
      return (
        <PendingRow
          key={item.id}
          item={item}
          onResolve={(value) => resolveInteraction(sessionId, item.interactionId, value)}
        />
      );
  }
}

function UserRow({ text, onQuote }: { text: string; onQuote: () => void }): ReactNode {
  return (
    <div className="group flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-user)] px-3.5 py-2">
        <p className="whitespace-pre-wrap break-words text-[13px] leading-6">{text}</p>
      </div>
      <div className="reveal-hover ml-1 flex shrink-0 items-start">
        <Button size="sm" onClick={onQuote} title="把这段引用到输入框追问">
          追问
        </Button>
      </div>
    </div>
  );
}

function AssistantRow({
  markdown,
  streaming,
  onQuote,
}: {
  markdown: string;
  streaming: boolean;
  onQuote: () => void;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group">
      <Markdown>{markdown}</Markdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--color-accent)] align-middle" />
      )}
      {!streaming && (
        <div className="reveal-hover mt-1 flex items-center gap-1">
          <Button
            size="sm"
            title="复制这段回答"
            onClick={() => {
              void navigator.clipboard?.writeText(markdown).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              });
            }}
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            {copied ? "已复制" : "复制"}
          </Button>
          <Button size="sm" onClick={onQuote} title="把这段引用到输入框追问">
            追问这段
          </Button>
        </div>
      )}
    </div>
  );
}

/** 产物分派：命令类看命令、文件类看路径、其余看归一化摘要。 */
function toolIconFor(toolName: string): ReactNode {
  const name = toolName.toLowerCase();
  if (toolName.startsWith("mcp__")) return <PlugIcon className="size-3.5" />;
  if (/^(bash|shell|exec)$/u.test(name)) return <TerminalIcon className="size-3.5" />;
  if (/^(write|write_file|edit|edit_file|multiedit|apply_patch)$/u.test(name)) {
    return <PencilIcon className="size-3.5" />;
  }
  if (/^(grep|search|glob|find|ls|list)$/u.test(name)) {
    return <SearchIcon className="size-3.5" />;
  }
  if (/^(todo|todowrite)$/u.test(name)) return <ListIcon className="size-3.5" />;
  return <FileTextIcon className="size-3.5" />;
}

function ToolRow({ item }: { item: Extract<DisplayItem, { kind: "tool" }> }): ReactNode {
  const [open, setOpen] = useState(false);
  const args = item.args as Record<string, unknown>;
  const content = toolContentPreview(args);
  const preview = toolOutputPreview(item.output);
  const hasBody = Object.keys(args).length > 0 || item.output !== "";

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-[var(--color-surface-raised)] ${
        item.status === "error"
          ? "border-[var(--color-danger)]"
          : "border-[var(--color-border-subtle)]"
      }`}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((current) => !current)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
          hasBody ? "hover:bg-[var(--color-surface-overlay)]" : "cursor-default"
        }`}
      >
        {hasBody ? (
          open ? (
            <ChevronDownIcon className="size-3 shrink-0 text-[var(--color-content-faint)]" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0 text-[var(--color-content-faint)]" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="shrink-0 text-[var(--color-content-muted)]">
          {toolIconFor(item.toolName)}
        </span>
        <span className="shrink-0 font-medium">{toolLabel(item.toolName)}</span>
        <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-content-muted)]">
          {toolSummary(item)}
        </span>
        {item.status === "running" && <Spinner />}
        {item.status === "done" && (
          <CheckIcon className="size-3.5 shrink-0 text-[var(--color-success)]" />
        )}
        {item.status === "error" && (
          <span className="shrink-0 text-[11px] text-[var(--color-danger)]">出错</span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-[var(--color-border-subtle)] px-2.5 py-2">
          {Object.keys(args).length > 0 && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-surface-code)] p-2 font-[var(--font-mono)] text-[11px] leading-4 text-[var(--color-content-muted)]">
              {JSON.stringify(args, null, 2)}
            </pre>
          )}
          {content !== null && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-surface-code)] p-2 font-[var(--font-mono)] text-[11px] leading-4">
              {content}
            </pre>
          )}
          {item.output !== "" && (
            <div className="rounded-md bg-[var(--color-surface-code)] p-2">
              {preview.hidden > 0 && (
                <p className="mb-1 text-[10px] text-[var(--color-content-faint)]">
                  … 省略前 {preview.hidden} 行
                </p>
              )}
              <pre
                className={`max-h-72 overflow-auto whitespace-pre-wrap break-all font-[var(--font-mono)] text-[11px] leading-4 ${
                  item.status === "error"
                    ? "text-[var(--color-danger)]"
                    : "text-[var(--color-content)]"
                }`}
              >
                {preview.lines.join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingRow({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const lines = text.trim().split("\n");
  const first = lines[0] ?? "";
  return (
    <div className="text-[11px] text-[var(--color-content-faint)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 text-left transition-colors hover:text-[var(--color-content-muted)]"
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <span className="shrink-0">思考</span>
        {!open && <span className="truncate italic">{first}</span>}
        <span className="ml-auto shrink-0">{lines.length} 行</span>
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap break-words border-l border-[var(--color-border-subtle)] pl-3 font-[inherit] text-[11px] leading-5 italic">
          {text}
        </pre>
      )}
    </div>
  );
}

function NoticeRow({ text, tone = "muted" }: { text: string; tone?: "muted" | "warn" }): ReactNode {
  return (
    <p
      className={`text-center text-[11px] ${
        tone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-content-faint)]"
      }`}
    >
      {text}
    </p>
  );
}

/** 持久化待决交互卡片（无人值守场景）：当时无人应答，现在可以补答。 */
function PendingRow({
  item,
  onResolve,
}: {
  item: Extract<DisplayItem, { kind: "pending" }>;
  onResolve: (value: string | boolean | null) => void;
}): ReactNode {
  const [resolved, setResolved] = useState<string | null>(null);
  const params = item.params as
    | { title?: string; message?: string; options?: string[] }
    | undefined;

  if (resolved !== null) return <NoticeRow text={`待决交互已处理（${resolved}）`} />;
  return (
    <div className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3">
      <p className="text-xs font-medium text-[var(--color-warn)]">
        待决交互：当时无人应答，已持久化
      </p>
      {params?.title !== undefined && <p className="mt-1 text-[13px]">{params.title}</p>}
      {params?.message !== undefined && (
        <p className="text-xs text-[var(--color-content-muted)]">{params.message}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {params?.options !== undefined ? (
          params.options.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === "拒绝" ? "danger" : "ghost"}
              onClick={() => {
                setResolved(option);
                onResolve(option);
              }}
            >
              {option}
            </Button>
          ))
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setResolved("允许");
                onResolve(true);
              }}
            >
              允许
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setResolved("拒绝");
                onResolve(false);
              }}
            >
              拒绝
            </Button>
          </>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--color-content-faint)]">
        应答后会作为新的消息转达给 agent（agent 据此重试或调整方案）。
      </p>
    </div>
  );
}
