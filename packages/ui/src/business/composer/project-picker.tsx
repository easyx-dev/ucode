/**
 * 草稿态的项目 chip 与它的弹层：从已登记的项目里选一个、选新目录、或落回小助理。
 *
 * 列表直接用项目登记表（行随会话创建自动登记、带展示名），不再从会话列表派生一份。
 */
import { ChevronDown, Folder, Search } from "lucide-react";
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
} from "../../base/dropdown-menu";
import { useProjects } from "../../hooks/use-projects";
import { abbreviateHome } from "../../lib/path";
import { projectLabel } from "../../lib/project";
import { openDirectoryPickerDialog } from "../directory-picker-dialog";

/** 可点的项目 / 分支 chip：无边框、悬停才给底色 */
export const PROJECT_CHIP_CLASS =
  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5";

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
      <DropdownMenuContent side="top" align="start" className="w-80">
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索工作区")}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            // 菜单会拦方向键与字符键做导航，输入框必须把它们留在自己这里
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        <DropdownMenuSeparator />
        {matched.length > 0 ? (
          <DropdownMenuRadioGroup value={path ?? ""} onValueChange={onSelect}>
            {matched.map((item) => (
              <DropdownMenuRadioItem key={item.path} value={item.path}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{projectLabel(item.path, item)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {abbreviateHome(item.path)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("还没有打开过项目")}</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void pickDirectory()}>
          <Folder />
          {t("选择目录")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect(null)}>{t("小助理")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
