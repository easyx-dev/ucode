/**
 * 全部改动：把所有变更文件的 diff 堆叠成一份文档，按已暂存 / 未暂存分组。
 *
 * 与单文件标签并存而不是取代——顺手改一处就在标签里看，一次过一遍大改动就在堆叠里扫。
 * 卡片本体在 `diff-stack` 里（提交详情共用），这里只补头部工具条与分组。
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "../../base/spinner";
import { useDiffPreferences } from "../../hooks/use-diff-prefs";
import { useGitStatus } from "../../hooks/use-workbench-data";
import { countChanges, type GitChangeGroup, groupChanges } from "../../lib/git-groups";
import { markOf } from "../../lib/git-marks";
import { DiffDisplayControls } from "./diff-controls";
import { DiffStack, type DiffStackItem } from "./diff-stack";
import { GitCounts } from "./git-marks";

/** 分组标题文案（key 即中文原文；查表取值处已收窄 t 的签名） */
const GROUP_TITLE: Record<GitChangeGroup["id"], string> = {
  staged: "已暂存", // i18n-ignore
  unstaged: "未暂存", // i18n-ignore
};

/** 变更条目 → 堆叠卡片（该组的 diff 取 index 侧还是工作区侧由分组决定） */
const itemsOf = (group: GitChangeGroup, cwd: string): DiffStackItem[] =>
  group.entries.map((entry) => ({
    file: entry.path,
    mark: markOf(entry),
    additions: entry.file.additions,
    deletions: entry.file.deletions,
    target: {
      path: cwd,
      file: entry.path,
      source: group.staged ? "staged" : "worktree",
    },
  }));

export function ChangesStack({ path, reloadToken }: { path: string; reloadToken: number }) {
  const { t } = useTranslation();
  const translate = t as (key: string) => string;
  const status = useGitStatus(path, reloadToken);
  const { mode, wrap, selectMode, toggleWrap } = useDiffPreferences();

  const groups = useMemo(() => (status.data ? groupChanges(status.data) : []), [status.data]);
  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const totals = useMemo(() => countChanges(entries), [entries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="shrink-0 text-xs font-medium">{t("全部改动")}</span>
        {status.data?.isRepo ? (
          <>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {t("{{value}} 个文件", { value: entries.length })}
            </span>
            <GitCounts additions={totals.additions} deletions={totals.deletions} />
          </>
        ) : null}
        <span className="ml-auto" />
        <DiffDisplayControls
          mode={mode}
          wrap={wrap}
          onSelectMode={selectMode}
          onToggleWrap={toggleWrap}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-2 pb-2 [&>section:first-child]:pt-2">
        {status.loading && !status.data ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : status.error ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{status.error.message}</p>
        ) : !status.data ? null : !status.data.isRepo ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {t("当前目录不在 git 仓库内，没有可查看的改动")}
          </p>
        ) : entries.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{t("工作区没有改动")}</p>
        ) : (
          groups.map((group) => (
            <section key={group.id} className="space-y-2">
              <p className="flex items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground">
                <span>{translate(GROUP_TITLE[group.id])}</span>
                <span className="tabular-nums text-muted-foreground/60">
                  {group.entries.length}
                </span>
              </p>
              <DiffStack
                items={itemsOf(group, path)}
                mode={mode}
                wrap={wrap}
                reloadToken={reloadToken}
              />
            </section>
          ))
        )}
      </div>
    </div>
  );
}
