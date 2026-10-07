/** 变更树：把改动按目录折成树，点文件看该文件的改动前后 diff */
import type { GitFileChange, GitStatusResponse } from "@ucode/contracts";
import { cn } from "cn";
import { ChevronRight, Folder } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildChangeTree, type ChangeTreeNode, countFiles } from "../../lib/git-tree";
import { GitCounts, GitStatusMark } from "./git-marks";

/** 点某个文件时要看的对比对象 */
export type GitChangeRef = { file: string; staged: boolean };

type Group = { id: string; title: string; files: GitFileChange[]; staged: boolean };

const groupsOf = (status: GitStatusResponse): Group[] => [
  { id: "conflicted", title: "有冲突", files: status.conflicted, staged: false }, // i18n-ignore
  { id: "staged", title: "已暂存", files: status.staged, staged: true }, // i18n-ignore
  { id: "unstaged", title: "未暂存", files: status.unstaged, staged: false }, // i18n-ignore
  { id: "untracked", title: "未跟踪", files: status.untracked, staged: false }, // i18n-ignore
];

export function GitChangeTree({
  status,
  onSelect,
}: {
  status: GitStatusResponse;
  onSelect: (ref: GitChangeRef) => void;
}) {
  const { t } = useTranslation();
  /** 分组标题按 id 查表取文案：key 是动态值，这里按需收窄 t 的签名 */
  const translate = t as (key: string) => string;
  // 收起的目录；缺省全展开——改动集通常不大，一眼看到文件比逐层点开更有用
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const groups = groupsOf(status).filter((group) => group.files.length > 0);

  if (groups.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">{t("工作区没有改动")}</p>;
  }

  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** 折叠键按「分组 + 目录」组合：三个分组各自渲染同一批路径，共用键会连带折叠别的分组 */
  const renderNode = (node: ChangeTreeNode, depth: number, group: Group): React.ReactNode => {
    const staged = group.staged;
    const collapseKey = `${group.id}:${node.path}`;
    if (node.file) {
      return (
        <button
          key={node.path}
          type="button"
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className="group flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          title={node.path}
          onClick={() => onSelect({ file: node.file?.path ?? node.path, staged })}
        >
          <GitStatusMark status={node.file.status} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <GitCounts additions={node.file.additions} deletions={node.file.deletions} />
        </button>
      );
    }

    const open = !collapsed.has(collapseKey);
    return (
      <div key={node.path}>
        <button
          type="button"
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className="flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          onClick={() => toggle(collapseKey)}
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          />
          <Folder className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
            {countFiles(node)}
          </span>
        </button>
        {open ? node.children.map((child) => renderNode(child, depth + 1, group)) : null}
      </div>
    );
  };

  return (
    <div className="py-1">
      {groups.map((group) => (
        <section key={group.id} className="py-1">
          <p className="px-3 py-1 text-[11px] font-medium text-muted-foreground">
            {translate(group.title)}
            <span className="ml-1 tabular-nums text-muted-foreground/60">{group.files.length}</span>
          </p>
          {buildChangeTree(group.files).children.map((node) => renderNode(node, 0, group))}
        </section>
      ))}
      {status.truncated ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("变更过多，仅列出前一部分")}</p>
      ) : null}
    </div>
  );
}
