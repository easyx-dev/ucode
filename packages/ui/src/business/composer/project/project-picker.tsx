/**
 * 草稿态的项目 chip 与它的弹层：从已登记的项目里选一个、选新目录、或落回小助理。
 *
 * 列表直接用项目登记表（行随会话创建自动登记、带展示名），不再从会话列表派生一份。
 */
import { ChevronDown, Folder, FolderOpen, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../base/dropdown-menu";
import { InputSearch } from "../../../base/input";
import { useProjects } from "../../../hooks/store/use-projects";
import type { ProjectSummary } from "../../../types";
import { abbreviateHome, baseName, dirName } from "../../../utils/path";
import { openDirectoryPickerDialog } from "../../dialog/directory-picker-dialog";
import { projectLabel } from "./project";

/** 项目 chip（弹层触发钮）：无边框、悬停才给底色 */
const PROJECT_CHIP_CLASS =
  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-foreground-subtle hover:bg-state-hover hover:text-foreground [&_svg]:size-icon-sm";

/**
 * 只显示名字时，「末段同名」的项目在列表里长得一模一样。这类名字收集起来，
 * 让那些行多带一个父目录名——名字是否重名只看登记表，不随搜索框变化。
 */
const duplicatedLabels = (projects: readonly ProjectSummary[]): Set<string> => {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const item of projects) {
    const label = projectLabel(item.path, item);
    if (seen.has(label)) duplicated.add(label);
    seen.add(label);
  }
  return duplicated;
};

type ProjectPickerProps = {
  /** 当前项目的展示名；未绑定项目时是「小助理」 */
  name: string;
  /** 当前项目路径；未绑定（小助理）时为 null */
  path: string | null;
  onSelect: (path: string | null) => void;
};

export function ProjectPicker({ name, path, onSelect }: ProjectPickerProps) {
  const { t } = useTranslation();
  const { projects } = useProjects();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const duplicated = useMemo(() => duplicatedLabels(projects), [projects]);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (item) =>
        projectLabel(item.path, item).toLowerCase().includes(needle) ||
        item.path.toLowerCase().includes(needle),
    );
  }, [projects, query]);

  const pickDirectory = async (): Promise<void> => {
    const picked = await openDirectoryPickerDialog();
    if (picked) onSelect(picked);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DropdownMenuTrigger
        className={PROJECT_CHIP_CLASS}
        title={path ? abbreviateHome(path) : t("不绑定项目，会话落在助理区")}
      >
        <Folder />
        {name}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-80 rounded-xl">
        <div className="p-1">
          <InputSearch
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索工作区")}
            className="h-11 border-0 bg-transparent pl-9"
            // 菜单会拦方向键与字符键做导航，输入框必须把它们留在自己这里
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        <DropdownMenuSeparator />
        {matched.length > 0 ? (
          <DropdownMenuRadioGroup value={path ?? ""} onValueChange={onSelect}>
            {matched.map((item) => {
              const label = projectLabel(item.path, item);
              return (
                <DropdownMenuRadioItem
                  key={item.path}
                  value={item.path}
                  // 路径不上行：重名的那几行补父目录名，其余靠悬停看全路径
                  title={abbreviateHome(item.path)}
                  className="cursor-pointer gap-2.5 px-2 py-3"
                >
                  <Folder className="size-icon-base shrink-0 text-foreground-subtle" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {duplicated.has(label) ? (
                    <span className="shrink-0 text-xs text-foreground-subtle">
                      · {baseName(dirName(item.path))}
                    </span>
                  ) : null}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="px-2 py-3 text-xs text-foreground-subtle">{t("还没有打开过项目")}</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2.5 px-2 py-3" onSelect={() => void pickDirectory()}>
          <FolderOpen className="size-icon-base shrink-0 text-foreground-subtle" />
          {t("选择目录")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2.5 px-2 py-3" onSelect={() => onSelect(null)}>
          <Sparkles className="size-icon-base shrink-0 text-foreground-subtle" />
          {t("小助理")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
