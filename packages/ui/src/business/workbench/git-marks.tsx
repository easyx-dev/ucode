/** git 变更条目的状态标记：字母 + 语义色，与 git 自己的惯例一致（M / A / D / R …） */
import type { GitFileStatus } from "@ucode/contracts";
import { cn } from "cn";

const LETTER: Record<GitFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typeChanged: "T",
  conflicted: "U",
};

const TONE: Record<GitFileStatus, string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
  renamed: "text-info",
  copied: "text-info",
  typeChanged: "text-muted-foreground",
  conflicted: "text-destructive",
};

/** 文件状态标记；宽度固定，便于列表对齐 */
export function GitStatusMark({ status }: { status: GitFileStatus }) {
  return (
    <span
      className={cn("w-3 shrink-0 text-center font-mono text-xs font-medium", TONE[status])}
      title={status}
    >
      {LETTER[status]}
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
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      {additions !== null && additions > 0 ? (
        <span className="text-success">+{additions}</span>
      ) : null}
      {deletions !== null && deletions > 0 ? (
        <span className="text-destructive">-{deletions}</span>
      ) : null}
    </span>
  );
}
