/**
 * 变更树：把变更按目录折成树，点文件打开该文件的 diff。
 *
 * 分组只有「已暂存」与「未暂存」两组——未跟踪与冲突都归进未暂存，靠字母标记区分
 * （未跟踪 U、冲突 !），免得用户在四段列表里来回找。目录行给出其下出现过的状态标记与文件数。
 *
 * 子模块路径既是指针变更的条目、又是它内部文件的父目录，折树后落在同一个节点上，因此这种节点
 * 按目录渲染，展开后第一行才是它自己。
 */
import type { GitStatusResponse } from "@ucode/contracts";
import { cn } from "cn";
import { ChevronRight, Folder } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, ContextMenuTrigger } from "../../../base/context-menu";
import { baseName, joinPath } from "../../../utils/path";
import { PathContextMenu } from "../file/path-context-menu";
import { GitCounts, GitStatusMark } from "./git-change-marks";
import { countChanges, type GitChangeGroup, groupChanges } from "./git-groups";
import { type GitChangeEntry, markLetter, markOf, markTone } from "./git-marks";
import { buildChangeTree, type ChangeTreeNode, countFiles, marksOf } from "./git-tree";

/** 点某个文件时要看的对比对象 */
export type GitChangeRef = { file: string; staged: boolean };

/** 分组标题文案（key 即中文原文；查表取值处已收窄 t 的签名） */
const GROUP_TITLE: Record<GitChangeGroup["id"], string> = {
  staged: "已暂存", // i18n-ignore
  unstaged: "未暂存", // i18n-ignore
};

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
  const groups = groupChanges(status);
  /** 复制路径用：变更路径是仓库相对，绝对路径得按仓库根拼（不在仓库内时根为空，拼出来的就是原路径） */
  const repoRoot = status.repoRoot ?? "";

  if (groups.length === 0) {
    return <p className="px-3 py-4 text-xs text-foreground-subtle">{t("工作区没有改动")}</p>;
  }

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** 文件行：点它打开该文件的 diff；子模块路径既有自己那一条、又是父目录，两处共用 */
  const renderFile = (
    item: GitChangeEntry,
    depth: number,
    group: GitChangeGroup,
  ): React.ReactNode => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className="group flex h-7 w-full items-center gap-1.5 pr-2 text-left text-xs text-foreground-subtle hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-selected data-[state=open]:text-foreground"
          title={item.path}
          onClick={() => onSelect({ file: item.path, staged: group.staged })}
        >
          <GitStatusMark mark={markOf(item)} />
          <span className="min-w-0 flex-1 truncate">{baseName(item.path)}</span>
          <GitCounts additions={item.file.additions} deletions={item.file.deletions} />
        </button>
      </ContextMenuTrigger>
      <PathContextMenu path={joinPath(repoRoot, item.path)} root={repoRoot} />
    </ContextMenu>
  );

  /** 折叠键按「分组 + 目录」组合：两个分组各自渲染同一批路径，共用键会连带折叠别的分组 */
  const renderNode = (
    node: ChangeTreeNode<GitChangeEntry>,
    depth: number,
    group: GitChangeGroup,
  ): React.ReactNode => {
    const entry = node.file;

    // 叶子即文件；既是文件又有子节点的只有子模块路径，那种要当目录渲染
    if (node.children.length === 0) {
      return entry ? <div key={node.path}>{renderFile(entry, depth, group)}</div> : null;
    }

    const collapseKey = `${group.id}:${node.path}`;
    const open = !collapsed.has(collapseKey);
    const marks = marksOf(node, markOf);
    return (
      <div key={node.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              style={{ paddingLeft: `${depth * 14 + 10}px` }}
              className="flex h-7 w-full items-center gap-1.5 pr-2 text-left text-xs text-foreground-subtle hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-selected data-[state=open]:text-foreground"
              onClick={() => toggle(collapseKey)}
            >
              <ChevronRight
                className={cn("size-icon-sm shrink-0 transition-transform", open && "rotate-90")}
              />
              <Folder className="size-icon-sm shrink-0" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span className="flex shrink-0 items-center gap-1 font-mono text-xs">
                {marks.map((mark) => (
                  <span key={mark} className={markTone(mark)}>
                    {markLetter(mark)}
                  </span>
                ))}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-foreground-subtlest">
                {countFiles(node)}
              </span>
            </button>
          </ContextMenuTrigger>
          <PathContextMenu path={joinPath(repoRoot, node.path)} root={repoRoot} />
        </ContextMenu>
        {open ? (
          <>
            {entry ? renderFile(entry, depth + 1, group) : null}
            {node.children.map((child) => renderNode(child, depth + 1, group))}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="py-1">
      {groups.map((group) => (
        <section key={group.id} className="py-1">
          <p className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-foreground-subtle">
            <span>{translate(GROUP_TITLE[group.id])}</span>
            {/* 标题行整行走正文字体：行内的等宽数字与汉字的字面高不同，混在一起看着不齐 */}
            <span className="font-sans tabular-nums text-foreground-subtlest">
              {group.entries.length}
            </span>
            <GitCounts {...countChanges(group.entries)} className="font-sans" />
          </p>
          {buildChangeTree(group.entries).children.map((node) => renderNode(node, 0, group))}
        </section>
      ))}
      {status.truncated ? (
        <p className="px-3 py-2 text-xs text-foreground-subtle">{t("变更过多，仅列出前一部分")}</p>
      ) : null}
    </div>
  );
}
