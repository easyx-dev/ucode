/** git 变更条目的状态标记：字母 + 语义色，与 git 自己的惯例一致（M / A / D / U / !） */
import { cn } from "cn";

import { type GitMark, markLetter, markTone } from "./git-marks";

/** 文件状态标记；宽度固定，便于列表对齐 */
export function GitStatusMark({ mark, className }: { mark: GitMark; className?: string }) {
  return (
    <span
      className={cn(
        "w-3 shrink-0 text-center font-mono text-xs font-medium",
        markTone(mark),
        className,
      )}
    >
      {markLetter(mark)}
    </span>
  );
}

/** 增删行数；两个都为 null（未跟踪 / 重命名 / 二进制）时不显示 */
export function GitCounts({
  additions,
  deletions,
}: {
  additions: number | null;
  deletions: number | null;
}) {
  if (additions === null && deletions === null) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
      {additions !== null && additions > 0 ? (
        <span className="text-success">+{additions}</span>
      ) : null}
      {deletions !== null && deletions > 0 ? (
        <span className="text-destructive">-{deletions}</span>
      ) : null}
    </span>
  );
}
