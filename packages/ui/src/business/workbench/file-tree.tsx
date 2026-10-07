/**
 * 文件树：逐层懒加载的目录浏览，顶部带筛选输入，点文件名打开预览。
 *
 * 每展开一层才拉一次 `fs/list`，结果按目录绝对路径缓存在组件内，「刷新」即整体丢弃重拉。
 * 筛选输入走服务端的 `fs/search`（全库、尊重 .gitignore、带缓存），结果是一份扁平列表——
 * 懒加载的树只知道自己展开过的目录，拿它过滤会让「筛选文件」看起来时灵时不灵。
 * 单层条目超过 `MAX_ENTRIES` 时只渲染前若干条并提示——`node_modules` 这类目录能有上万项。
 */
import type { FsEntry } from "@ucode/contracts";
import { cn } from "cn";
import { ChevronRight, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../base/button";
import { Input } from "../../base/input";
import { Spinner } from "../../base/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../base/tooltip";
import { fileIconOf } from "../../lib/file-icons";
import { baseName, toRelativePath } from "../../lib/path";
import { useClient } from "../../provider";
import { useWorkbench } from "../../provider/workbench";

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

export function FileTree({ root, activeFile }: { root: string; activeFile: string | null }) {
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
    return (
      <>
        {all.slice(0, MAX_ENTRIES).map((entry) => {
          const isDir = entry.type === "directory";
          const isOpen = isDir && expanded.has(entry.path);
          return (
            <div key={entry.path}>
              <TreeRow
                entry={entry}
                depth={depth}
                open={isOpen}
                active={entry.path === activeFile}
                onSelect={() => (isDir ? toggle(entry) : workbench?.openPreview(entry.path))}
              />
              {isOpen ? renderDir(entry.path, depth + 1) : null}
            </div>
          );
        })}
        {all.length > MAX_ENTRIES ? (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">
            {t("仅列出前 {{value}} 项，共 {{total}} 项", { value: MAX_ENTRIES, total: all.length })}
          </p>
        ) : null}
      </>
    );
  };

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <p className="truncate px-0.5 pb-1.5 text-xs font-medium text-foreground" title={root}>
          {baseName(root) || root}
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder={t("筛选文件")}
            className="h-7 pl-7 text-xs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {root}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0"
              title={t("刷新目录")}
              onClick={() => setTree(emptyTree())}
            >
              <RefreshCw className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("刷新目录")}</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {tree.loading.has(root) && !tree.children.has(root) ? (
          <div className="flex justify-center py-3">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : matches ? (
          matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {searching ? t("搜索中…") : t("没有匹配的文件")}
            </p>
          ) : (
            <>
              {matches.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={cn(
                    "flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left text-xs",
                    entry.path === activeFile
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                  title={entry.path}
                  onClick={() => workbench?.openPreview(entry.path)}
                >
                  {(() => {
                    const Icon = fileIconOf(entry.path);
                    return <Icon className="size-3.5 shrink-0" />;
                  })()}
                  <span className="shrink-0 truncate">{entry.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
                    {toRelativePath(root, entry.path)}
                  </span>
                </button>
              ))}
              {matchesTruncated ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">
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
  depth,
  open,
  active,
  onSelect,
}: {
  entry: FsEntry;
  depth: number;
  open: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const isDir = entry.type === "directory";
  const Icon = isDir ? null : fileIconOf(entry.path);

  return (
    <button
      type="button"
      style={{ paddingLeft: `${depth * 14 + 10}px` }}
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-xs",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60",
      )}
      title={entry.path}
      onClick={onSelect}
    >
      {isDir ? (
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      ) : (
        <span className="w-3.5 shrink-0" aria-hidden />
      )}
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}
