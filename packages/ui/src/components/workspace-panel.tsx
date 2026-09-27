import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useAgentStore } from "../context.ts";
import { Markdown } from "./markdown.tsx";
import { Badge, Button, Card } from "./primitives.tsx";
import {
  buildTreeRows,
  changeStatusLabel,
  fileIcon,
  filterTreeRows,
  formatBytes,
  isImagePath,
} from "./workspace-format.ts";

/**
 * 工作区面板（F-2.7 文件树 / Git 图谱 / 变更筛选，F-2.8 内容预览）。
 *
 * 三个页签共用一个"选中文件 → 预览"的交互：
 * - 文件：树 + 关键词筛选，点文件看内容；
 * - 变更：`git status` 分类列表，点条目也能直接看那个文件；
 * - 历史：提交列表（分页由 SDK 的 limit 控制）。
 *
 * 数据全部来自**结构化查询通道**（不是跑 `ls`/`git log` 解析输出）——这是 F-2.7 的硬要求，
 * 否则 UI 性能会被命令解析绑住。
 */

type Tab = "tree" | "changes" | "history";

export function WorkspacePanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}): ReactNode {
  const workspace = useAgentStore((store) => store.workspace[sessionId]);
  const loadWorkspace = useAgentStore((store) => store.loadWorkspace);
  const openFile = useAgentStore((store) => store.openFile);
  const closeFile = useAgentStore((store) => store.closeFile);
  const [tab, setTab] = useState<Tab>("tree");
  const [keyword, setKeyword] = useState("");

  const state = workspace;
  const rows = useMemo(() => buildTreeRows(state?.tree ?? []), [state?.tree]);
  const visible = useMemo(() => filterTreeRows(rows, keyword), [rows, keyword]);
  const file = state?.file ?? null;

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
        <div className="flex gap-1">
          {(["tree", "changes", "history"] as const).map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={tab === candidate ? "primary" : "ghost"}
              onClick={() => setTab(candidate)}
            >
              {candidate === "tree" ? "文件" : candidate === "changes" ? "变更" : "历史"}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" title="刷新" onClick={() => void loadWorkspace(sessionId)}>
            刷新
          </Button>
          <Button size="sm" title="关闭" onClick={onClose}>
            ×
          </Button>
        </div>
      </header>

      {state?.error != null && (
        <div className="border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] text-[var(--color-danger)]">
          {state.error}
        </div>
      )}

      {tab === "tree" && (
        <div className="border-b border-[var(--color-border-subtle)] p-2">
          <input
            className="w-full rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-2 py-1 text-[12px]"
            placeholder="筛选文件（含路径）"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 font-[var(--font-mono)] text-[12px]">
        {state?.loading === true && (
          <p className="p-2 text-[11px] text-[var(--color-content-muted)]">加载中…</p>
        )}
        {tab === "tree" &&
          visible.map((row) => (
            <button
              key={row.entry.path}
              type="button"
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--color-surface-overlay)]"
              style={{ paddingLeft: `${row.depth * 12 + 4}px` }}
              onClick={() =>
                row.entry.kind === "file" ? void openFile(sessionId, row.entry.path) : undefined
              }
            >
              <span className="text-[var(--color-content-muted)]">{fileIcon(row.entry)}</span>
              <span className="truncate">{row.label}</span>
              {row.entry.size !== undefined && (
                <span className="ml-auto text-[10px] text-[var(--color-content-muted)]">
                  {formatBytes(row.entry.size)}
                </span>
              )}
            </button>
          ))}
        {tab === "tree" && visible.length === 0 && state?.loading !== true && (
          <p className="p-2 text-[11px] text-[var(--color-content-muted)]">没有匹配的文件。</p>
        )}

        {tab === "changes" && (state?.changes.length ?? 0) === 0 && (
          <p className="p-2 text-[11px] text-[var(--color-content-muted)]">
            没有未提交的变更（或这不是 Git 仓库）。
          </p>
        )}
        {tab === "changes" &&
          state?.changes.map((change) => {
            const badge = changeStatusLabel(change.status);
            return (
              <button
                key={`${change.status}:${change.path}`}
                type="button"
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-[var(--color-surface-overlay)]"
                onClick={() => void openFile(sessionId, change.path)}
              >
                <Badge tone={badge.tone}>{badge.label}</Badge>
                <span className="truncate">{change.path}</span>
              </button>
            );
          })}

        {tab === "history" && (state?.commits.length ?? 0) === 0 && (
          <p className="p-2 text-[11px] text-[var(--color-content-muted)]">
            没有提交历史（或这不是 Git 仓库）。
          </p>
        )}
        {tab === "history" &&
          state?.commits.map((commit) => (
            <div key={commit.hash} className="px-1 py-1">
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-accent)]">{commit.shortHash}</span>
                <span className="truncate">{commit.subject}</span>
              </div>
              <div className="text-[10px] text-[var(--color-content-muted)]">
                {commit.author} · {commit.date.slice(0, 10)}
              </div>
            </div>
          ))}
      </div>

      {file !== null && (
        <PreviewPane
          path={file.path}
          content={file.content}
          truncated={file.truncated}
          size={file.size}
          onClose={() => closeFile(sessionId)}
        />
      )}
    </aside>
  );
}

function PreviewPane({
  path,
  content,
  truncated,
  size,
  onClose,
}: {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
  onClose: () => void;
}): ReactNode {
  const isImage = isImagePath(path);
  const isMarkdown = /\.(md|markdown)$/iu.test(path);
  return (
    <Card className="m-2 flex max-h-[45%] flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-2 py-1.5">
        <span className="truncate font-[var(--font-mono)] text-[11px]">{path}</span>
        <span className="ml-auto shrink-0 text-[10px] text-[var(--color-content-muted)]">
          {formatBytes(size)}
        </span>
        <Button size="sm" onClick={onClose}>
          ×
        </Button>
      </div>
      <div className="overflow-auto p-2">
        {isImage ? (
          <p className="text-[11px] text-[var(--color-content-muted)]">
            图片预览暂未支持（内容查询返回文本）。
          </p>
        ) : isMarkdown ? (
          <Markdown>{content}</Markdown>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-[var(--font-mono)] text-[12px] leading-5">
            {content}
          </pre>
        )}
        {truncated && (
          <p className="mt-2 text-[10px] text-[var(--color-warn)]">文件较大，仅显示开头一部分。</p>
        )}
      </div>
    </Card>
  );
}
