/**
 * 堆叠的 diff 卡片：一份列表里每块一个文件，文件头吸顶、可折起、进入视口才取数。
 *
 * 「全部改动」与提交详情都用它——两者的差别只在「列哪些文件、每个怎么取」（`target` 由调用方给），
 * 所以这里只认 `DiffStackItem`。块内不给「全部展开」：一屏铺出上万行不是这里该干的事。
 */
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useInViewOnce } from "../../../hooks/use-in-view";
import type { GitDiffTarget } from "../use-workbench-data";
import type { DiffMode } from "./diff-prefs";
import { DiffViewer } from "./diff-viewer";
import { GitCounts, GitStatusMark } from "./git-change-marks";
import type { GitMark } from "./git-marks";
import { useFileDiff } from "./use-file-diff";

export type DiffStackItem = {
  /** 卡片头显示的仓库相对路径 */
  file: string;
  mark: GitMark;
  additions: number | null;
  deletions: number | null;
  /** 这个文件怎么取 diff（工作区 / 已暂存 / 某次提交） */
  target: GitDiffTarget;
};

export function DiffStack({
  items,
  mode,
  wrap,
  reloadToken,
}: {
  items: readonly DiffStackItem[];
  mode: DiffMode;
  wrap: boolean;
  reloadToken: number;
}) {
  /** 折起的文件（按路径记）：只影响展示，不影响取数 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (file: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <StackedDiff
          key={item.file}
          item={item}
          mode={mode}
          wrap={wrap}
          reloadToken={reloadToken}
          collapsed={collapsed.has(item.file)}
          onToggle={() => toggle(item.file)}
        />
      ))}
    </div>
  );
}

/** 一块：文件头 + 该文件的 diff；折起时只留文件头，内容不挂载（也就不取数） */
function StackedDiff({
  item,
  mode,
  wrap,
  reloadToken,
  collapsed,
  onToggle,
}: {
  item: DiffStackItem;
  mode: DiffMode;
  wrap: boolean;
  reloadToken: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    // 不用 `overflow-hidden`：它会把卡片变成 sticky 的参照物，文件头就吸不住了
    <section className="rounded-lg border border-border">
      <button
        type="button"
        className={cn(
          "sticky top-0 z-10 flex h-9 w-full items-center gap-2 bg-surface px-2 text-left hover:bg-state-hover",
          // 折起时下面没有内容，底边线多余；反过来头部要自己圆上上下两个角
          collapsed ? "rounded-lg" : "rounded-t-lg",
        )}
        title={item.file}
        onClick={onToggle}
      >
        <ChevronRight
          className={cn(
            "size-icon-sm shrink-0 text-foreground-subtle transition-transform",
            !collapsed && "rotate-90",
          )}
        />
        <GitStatusMark mark={item.mark} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.file}</span>
        <GitCounts additions={item.additions} deletions={item.deletions} />
      </button>
      {collapsed ? null : (
        <StackedDiffBody target={item.target} mode={mode} wrap={wrap} reloadToken={reloadToken} />
      )}
    </section>
  );
}

/** 内容与取数绑在一起：进入视口才挂载，避免几十个文件同时取数把本地服务打满 */
function StackedDiffBody({
  target,
  mode,
  wrap,
  reloadToken,
}: {
  target: GitDiffTarget;
  mode: DiffMode;
  wrap: boolean;
  reloadToken: number;
}) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();

  return (
    // 分隔线画在内容上而不是文件头：头部是 sticky 的，折起时也不该留下一条悬空的线
    <div ref={ref} className="border-t border-border p-2">
      {inView ? (
        <StackedDiffContent target={target} mode={mode} wrap={wrap} reloadToken={reloadToken} />
      ) : (
        <div className="h-24 animate-pulse rounded-md bg-muted/40" />
      )}
    </div>
  );
}

/** 真正取数并渲染的那一层：挂载时才开始请求 */
function StackedDiffContent({
  target,
  mode,
  wrap,
  reloadToken,
}: {
  target: GitDiffTarget;
  mode: DiffMode;
  wrap: boolean;
  reloadToken: number;
}) {
  const fileDiff = useFileDiff(target, reloadToken);

  return <DiffViewer target={target} fileDiff={fileDiff} mode={mode} wrap={wrap} />;
}
