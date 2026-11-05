/**
 * 记忆设置页的「项目记忆」一段：按项目列出已有记忆，展开读正文，悬停给改 / 删入口。
 *
 * 记忆按会话工作目录归口、落在本机磁盘上（`$APP_HOME/app/memory/projects/`），所以这一段的单位是
 * 「项目」而不是「会话」；项目名取侧栏里改过的名字，路径照原样给出，好让人对上到底是哪个目录。
 * 反查不到路径的目录（原会话已删除、目录被手工搬过）也照列——内容还在，只是标不出项目。
 *
 * 只有改与删：新增记忆是模型侧的事（「记住」与自动回顾），这里不提供起草入口。
 */
import type { MemoryProjectView } from "@ucode/contracts";
import { cn } from "cn";
import { Brain, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, IconButton } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { Spinner } from "../../../base/spinner";
import { useErrorText } from "../../../hooks/use-error-text";
import { HOVER_ACTION_CLASS } from "../../../utils/hover-actions";
import { confirm } from "../../dialog/queue";
import { SettingsSectionHeader } from "../settings-page";
import { SettingsGroup } from "../settings-row";
import { openMemoryEditDialog } from "./memory-edit-dialog";
import { memoryFactKey, useMemoryLibrary } from "./use-memory-library";

/** 项目标题：展示名优先，其次路径末段，反查不到时退回目录名 */
const projectLabel = (project: MemoryProjectView): string =>
  project.name ?? project.path?.split("/").filter(Boolean).at(-1) ?? project.dir;

/** 一个项目的记忆：折叠时只报条数，展开才列条目 */
function MemoryProject({
  project,
  facts,
  loadingKey,
  onExpand,
  onEdit,
  onRemove,
}: {
  project: MemoryProjectView;
  facts: ReturnType<typeof useMemoryLibrary>["facts"];
  loadingKey: string | null;
  onExpand: (open: boolean, dir: string, file: string | undefined) => void;
  onEdit: (dir: string, file: string) => void;
  onRemove: (dir: string, file: string, title: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** 当前展开的那一条正文；同一时刻只展开一条，长清单才不会一屏全是明细 */
  const [openFile, setOpenFile] = useState<string | null>(null);

  const toggleFile = (file: string): void => {
    const next = openFile === file ? null : file;
    setOpenFile(next);
    if (next) onExpand(true, project.dir, next);
  };

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-state-hover"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) setOpenFile(null);
        }}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-icon-base shrink-0 text-foreground-subtle transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{projectLabel(project)}</span>
        <span className="shrink-0 text-xs text-foreground-subtle tabular-nums">
          {t("{{count}} 条", { count: project.entries.length })}
        </span>
        {project.enabled ? null : (
          <span className="shrink-0 rounded-xs bg-muted px-1.5 py-0.5 text-xs text-foreground-subtle">
            {t("已关闭")}
          </span>
        )}
      </button>

      {open ? (
        <div className="px-4 pb-3">
          {project.path ? (
            <p className="pb-2 pl-6 font-mono text-xs break-all text-foreground-subtlest">
              {project.path}
            </p>
          ) : (
            <p className="pb-2 pl-6 text-xs text-foreground-subtle">
              {t("这个目录已不在项目记录里：内容还在磁盘上，但对应不到具体项目。")}
            </p>
          )}

          {project.entries.length === 0 ? (
            <p className="py-2 pl-6 text-xs text-foreground-subtle">{t("索引里还没有条目。")}</p>
          ) : (
            <ul className="pl-6">
              {project.entries.map((entry) => {
                const key = memoryFactKey(project.dir, entry.file);
                const fact = facts[key];
                const expanded = openFile === entry.file;
                return (
                  <li key={entry.file} className="group">
                    {/* 展开与「改 / 删」是两个动作：前者铺满整行，后两者只在悬停 / 聚焦时出现在行尾 */}
                    <div className="flex items-start gap-1">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-1.5 text-left hover:bg-state-hover"
                        onClick={() => toggleFile(entry.file)}
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            "mt-0.5 size-icon-xs shrink-0 text-foreground-subtle transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{entry.title}</span>
                          {entry.description ? (
                            <span className="block truncate text-xs text-foreground-subtle">
                              {entry.description}
                            </span>
                          ) : null}
                        </span>
                        {loadingKey === key ? <Spinner className="size-icon-xs" /> : null}
                      </button>
                      <div
                        className={cn(
                          HOVER_ACTION_CLASS,
                          "flex shrink-0 items-center gap-0.5 group-hover:opacity-100 group-focus-within:opacity-100",
                        )}
                      >
                        <IconButton
                          size="icon-xs"
                          label={t("编辑记忆")}
                          onClick={() => onEdit(project.dir, entry.file)}
                        >
                          <Pencil className="size-icon-sm" />
                        </IconButton>
                        <IconButton
                          size="icon-xs"
                          label={t("删除记忆")}
                          className="hover:text-destructive"
                          onClick={() => onRemove(project.dir, entry.file, entry.title)}
                        >
                          <Trash2 className="size-icon-sm" />
                        </IconButton>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="mb-2 ml-5 rounded-md border border-border bg-muted/40 p-3">
                        {fact ? (
                          <pre className="max-h-80 overflow-auto font-mono text-xs break-words whitespace-pre-wrap">
                            {fact.content}
                          </pre>
                        ) : (
                          <p className="text-xs text-foreground-subtle">
                            {loadingKey === key ? t("读取中…") : t("读不到这条记忆。")}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsMemoryProjects() {
  const { t } = useTranslation();
  const { data, error, reload, facts, loadingKey, loadFact, saveFact, removeFact } =
    useMemoryLibrary();
  const errorText = useErrorText(error);

  const total = data?.projects.reduce((sum, project) => sum + project.entries.length, 0) ?? 0;

  /** 编辑：先取回正文（缓存优先）再开弹层；取不回来就说清是哪一步失败 */
  const editEntry = async (dir: string, file: string): Promise<void> => {
    const fact = await loadFact(dir, file);
    if (!fact) {
      toast.error(t("读不到这条记忆。"));
      return;
    }
    const draft = await openMemoryEditDialog({
      file,
      title: fact.title,
      content: fact.content,
    });
    if (!draft) return;
    await saveFact(dir, file, draft);
  };

  const removeEntry = async (dir: string, file: string, title: string): Promise<void> => {
    const confirmed = await confirm({
      title: t("删除这条记忆？"),
      description: t("「{{title}}」会从磁盘上删掉，索引行一并移除，之后不会再带进上下文。", {
        title,
      }),
      confirmText: t("删除"),
      destructive: true,
    });
    if (!confirmed) return;
    await removeFact(dir, file);
  };

  return (
    <div className="space-y-3">
      <SettingsSectionHeader
        title={t("本机上的项目记忆")}
        meta={data ? t("{{count}} 条", { count: total }) : null}
      />
      {errorText ? (
        // 读不到 ≠ 没有记忆：这里不能退化成空态，否则看起来像记忆丢了
        <div className="flex items-start gap-2 rounded-xl border border-dashed px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-destructive">{errorText}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            {t("重试")}
          </Button>
        </div>
      ) : data === null ? null : data.projects.length === 0 ? (
        <Empty
          className="rounded-xl border border-dashed px-6 py-9"
          icon={<Brain className="size-icon-lg" />}
          title={t("还没有项目记忆")}
          hint={t("开启记忆后，每轮对话结束会在后台回顾并保存；也可以直接让助理「记住」某件事。")}
        />
      ) : (
        <SettingsGroup>
          {data.projects.map((project) => (
            <MemoryProject
              key={project.dir}
              project={project}
              facts={facts}
              loadingKey={loadingKey}
              onExpand={(open, dir, file) => {
                if (open && file) void loadFact(dir, file);
              }}
              onEdit={(dir, file) => void editEntry(dir, file)}
              onRemove={(dir, file, title) => void removeEntry(dir, file, title)}
            />
          ))}
        </SettingsGroup>
      )}
    </div>
  );
}
