/**
 * 文件树：逐层懒加载的目录浏览，顶部带筛选输入，点文件名打开预览。
 *
 * 每展开一层才拉一次 `fs/list`，结果按目录绝对路径缓存在组件内，「刷新」即整体丢弃重拉。
 * 筛选输入走服务端的 `fs/search`（全库、尊重 .gitignore、带缓存），结果是一份扁平列表——
 * 懒加载的树只知道自己展开过的目录，拿它过滤会让「筛选文件」看起来时灵时不灵。
 * 单层条目超过 `MAX_ENTRIES` 时只渲染前若干条并提示——`node_modules` 这类目录能有上万项。
 *
 * 有仓库状态时给行加 git 装饰（名字着色 + 字母徽标，目录用其下最重的标记着色），
 * 与 VSCode 的资源管理器一致：改动过的文件在树里一眼可辨，不必切到代码管理视图。
 */
import type { FsEntry } from "@ucode/contracts";
import { cn } from "cn";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../../base/button";
import { ContextMenu, ContextMenuTrigger } from "../../../base/context-menu";
import { InputSearch } from "../../../base/input";
import { Spinner } from "../../../base/spinner";
import { useClient } from "../../../provider";
import { useWorkbench } from "../../../provider/workbench";
import { fileIconOf } from "../../../utils/file-icons";
import { baseName, toRelativePath } from "../../../utils/path";
import { type GitMark, type GitMarks, markLetter, markTone } from "../git/git-marks";
import { PathContextMenu } from "./path-context-menu";

/** 单层最多渲染的条目数 */
const MAX_ENTRIES = 200;

/** 筛选（全库检索）一次最多要几条 */
const SEARCH_LIMIT = 100;

type TreeState = {
  /** 目录绝对路径 → 该目录的条目 */
  children: Map<string, FsEntry[]>;
  /** 正在加载的目录 */
  loading: Set<string>;
};

const emptyTree = (): TreeState => ({ children: new Map(), loading: new Set() });

/** 行上的装饰：有变更时名字用状态色，并在右侧补一个字母徽标 */
const nameToneOf = (mark: GitMark | undefined, active: boolean): string => {
  if (mark) return markTone(mark);
  return active ? "font-medium text-foreground" : "text-foreground-subtle";
};

export function FileTree({
  root,
  activeFile,
  marks,
}: {
  root: string;
  /** 编辑器里正打开的普通文件；用于高亮 */
  activeFile: string | null;
  /** 仓库装饰；没有仓库时为 null */
  marks: GitMarks | null;
}) {
  const { t } = useTranslation();
  const client = useClient();
  const workbench = useWorkbench();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([root]));
  const [tree, setTree] = useState<TreeState>(emptyTree);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FsEntry[] | null>(null);
  const [matchesTruncated, setMatchesTruncated] = useState(false);
  const [searching, setSearching] = useState(false);

  // 切会话时工作目录会变：重置展开状态、缓存与筛选词，只留新根
  useEffect(() => {
    setExpanded(new Set([root]));
    setTree(emptyTree());
    setQuery("");
  }, [root]);

  const loadDir = useCallback(
    async (dir: string) => {
      setTree((prev) => ({ ...prev, loading: new Set(prev.loading).add(dir) }));
      try {
        const result = await client.apis.fs.list({ path: dir });
        setTree((prev) => {
          const children = new Map(prev.children);
          children.set(dir, result.entries);
          const loading = new Set(prev.loading);
          loading.delete(dir);
          return { children, loading };
        });
      } catch {
        // 权限不足 / 目录刚被删掉：只结束该目录的加载态，不影响整棵树
        setTree((prev) => {
          const loading = new Set(prev.loading);
          loading.delete(dir);
          return { ...prev, loading };
        });
      }
    },
    [client],
  );

  // 展开的目录都必须有数据：新展开的在这里补拉，刷新（缓存清空）后重拉已展开的全部
  useEffect(() => {
    for (const dir of expanded) {
      if (!tree.children.has(dir) && !tree.loading.has(dir)) void loadDir(dir);
    }
  }, [expanded, tree.children, tree.loading, loadDir]);

  // 检索：输入停顿 200ms 后请求，只出文件（目录点开也没有内容可看）
  const needle = query.trim();
  useEffect(() => {
    if (!needle) {
      setMatches(null);
      setMatchesTruncated(false);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void client.apis.fs
        .search({ path: root, q: needle, limit: SEARCH_LIMIT })
        .then((result) => {
          if (cancelled) return;
          setMatches(result.entries.filter((entry) => entry.type === "file"));
          setMatchesTruncated(result.truncated);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, needle, root]);

  const toggle = (entry: FsEntry): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  };

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const all = tree.children.get(dir) ?? [];
    const total = Math.min(all.length, MAX_ENTRIES);
    return (
      <div>
        {all.slice(0, MAX_ENTRIES).map((entry, index) => {
          const isDir = entry.type === "directory";
          const isOpen = isDir && expanded.has(entry.path);
          return (
            <div key={entry.path}>
              <TreeRow
                entry={entry}
                root={root}
                depth={depth}
                position={index}
                total={total}
                open={isOpen}
                active={entry.path === activeFile}
                mark={isDir ? marks?.dirs.get(entry.path) : marks?.files.get(entry.path)}
                onSelect={() => (isDir ? toggle(entry) : workbench?.openFile(entry.path))}
              />
              {isOpen ? renderDir(entry.path, depth + 1) : null}
            </div>
          );
        })}
        {all.length > MAX_ENTRIES ? (
          <p className="px-2 py-1 text-xs text-foreground-subtle">
            {t("仅列出前 {{value}} 项，共 {{total}} 项", { value: MAX_ENTRIES, total: all.length })}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 与代码管理的头部同高（36px）：切视图时列表不会跳 */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-2">
        <div className="min-w-0 flex-1">
          <InputSearch
            value={query}
            placeholder={t("在「{{name}}」中筛选文件", { name: baseName(root) || root })}
            // 与下方列表行同高（`h-7`），也与代码管理头部里的分段控件同档：24px 在这条 36px 的头部里偏窄。
            // 窄屏不跟着缩字号：16px 是 iOS 聚焦不缩放页面的前提（DESIGN.md「响应式」），此处是该例外唯一要走上的输入框
            className="h-8 text-base md:h-7 md:text-xs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <IconButton label={t("刷新目录")} size="icon-xs" onClick={() => setTree(emptyTree())}>
          <RefreshCw className="size-icon-sm" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label={t("项目文件")}>
        {tree.loading.has(root) && !tree.children.has(root) ? (
          <div className="flex justify-center py-3">
            <Spinner className="text-foreground-subtle" />
          </div>
        ) : matches ? (
          matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-foreground-subtle">
              {searching ? t("搜索中…") : t("没有匹配的文件")}
            </p>
          ) : (
            <>
              {matches.map((entry) => (
                <FlatRow
                  key={entry.path}
                  entry={entry}
                  root={root}
                  active={entry.path === activeFile}
                  mark={marks?.files.get(entry.path)}
                  onSelect={() => workbench?.openFile(entry.path)}
                />
              ))}
              {matchesTruncated ? (
                <p className="px-2 py-1 text-xs text-foreground-subtle">
                  {t("仅显示前 {{value}} 条", { value: SEARCH_LIMIT })}
                </p>
              ) : null}
            </>
          )
        ) : (
          renderDir(root, 0)
        )}
      </div>
    </div>
  );
}

/** 一行：目录只有折叠箭头（对齐图里「不画文件夹图标」的做法），文件按类型给图标 */
function TreeRow({
  entry,
  root,
  depth,
  position,
  total,
  open,
  active,
  mark,
  onSelect,
}: {
  entry: FsEntry;
  root: string;
  depth: number;
  position: number;
  total: number;
  open: boolean;
  active: boolean;
  mark: GitMark | undefined;
  onSelect: () => void;
}) {
  const isDir = entry.type === "directory";
  const Icon = isDir ? null : fileIconOf(entry.path);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-posinset={position + 1}
          aria-setsize={total}
          {...(isDir ? { "aria-expanded": open } : {})}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={cn(
            "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs",
            nameToneOf(mark, active),
            !mark && active ? "bg-muted" : "hover:bg-state-hover",
            // 右键唤出菜单的那一刻也算选中：菜单要作用在哪一行得看得见
            "data-[state=open]:bg-state-selected",
          )}
          title={entry.path}
          onClick={onSelect}
        >
          {isDir ? (
            <ChevronRight
              className={cn("size-icon-sm shrink-0 transition-transform", open && "rotate-90")}
            />
          ) : (
            <span className="w-3.5 shrink-0" aria-hidden />
          )}
          {Icon ? <Icon className="size-icon-sm shrink-0" /> : null}
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {mark ? <MarkBadge mark={mark} /> : null}
        </button>
      </ContextMenuTrigger>
      <PathContextMenu path={entry.path} root={root} />
    </ContextMenu>
  );
}

/** 筛选结果是扁平列表，行里补一段相对路径，省得同名文件分不清 */
function FlatRow({
  entry,
  root,
  active,
  mark,
  onSelect,
}: {
  entry: FsEntry;
  root: string;
  active: boolean;
  mark: GitMark | undefined;
  onSelect: () => void;
}) {
  const Icon = fileIconOf(entry.path);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          // 筛选结果是扁平的一层节点，仍走 tree/treeitem 语义：容器的 children 得是同一种角色
          role="treeitem"
          aria-level={1}
          className={cn(
            "flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs",
            nameToneOf(mark, active),
            !mark && active ? "bg-muted" : "hover:bg-state-hover",
            // 右键唤出菜单的那一刻也算选中
            "data-[state=open]:bg-state-selected",
          )}
          title={entry.path}
          onClick={onSelect}
        >
          <Icon className="size-icon-sm shrink-0" />
          <span className="shrink-0 truncate">{entry.name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground-subtlest">
            {toRelativePath(root, entry.path)}
          </span>
          {mark ? <MarkBadge mark={mark} /> : null}
        </button>
      </ContextMenuTrigger>
      <PathContextMenu path={entry.path} root={root} />
    </ContextMenu>
  );
}

/** 状态徽标：字母右对齐，颜色取标记自己的色调 */
function MarkBadge({ mark }: { mark: GitMark }) {
  return (
    <span className={cn("ml-auto shrink-0 font-mono text-xs", markTone(mark))} aria-hidden>
      {markLetter(mark)}
    </span>
  );
}
