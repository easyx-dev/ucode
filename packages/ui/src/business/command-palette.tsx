/**
 * 命令面板（⌘K）：搜索操作、会话与文件。
 *
 * 操作是界面动作与内置命令；会话按标题 / 预览过滤（在本地，与服务端事件不打架）；
 * 文件走 `fs/search` 并在输入停顿后拉取。键盘上下选择、Enter 执行、Esc 关闭由 Dialog 兜底。
 * 文件结果的动作经 `onOpenFile` 交给上层：查看器尚未实现时由上层决定兜底行为。
 */
import type { FsEntry, SessionSummary } from "@ucode/contracts";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import {
  CirclePlus,
  File as FileIcon,
  List,
  MessageSquare,
  PanelLeft,
  PanelsTopLeft,
  Search,
  Settings2,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "../base/dialog";
import { BUILTIN_COMMANDS, type BuiltinCommandId } from "../lib/builtin-commands";
import { MOD_KEY_LABEL } from "../lib/platform";
import { sessionTitle } from "../lib/session";
import { relativeTimeLabel } from "../lib/time";
import { useClient } from "../provider";

type PaletteTab = "all" | "actions" | "tasks" | "files";

/** 结果分组标识；标题在渲染时取 i18n，避免模块级常量绑死文案 */
type PaletteGroupId = "actions" | "commands" | "tasks" | "files";

type PaletteItem = {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: LucideIcon;
  run: () => void;
};

type PaletteGroup = {
  id: PaletteGroupId;
  title: string;
  items: PaletteItem[];
};

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionSummary[];
  /** 文件检索根目录（当前会话 cwd 或助理工作区）；null 时不搜文件 */
  fileRoot: string | null;
  /** 是否有当前会话：与 `/` 菜单同口径，草稿态隐藏需要会话才能执行的命令 */
  hasSession: boolean;
  onSelectSession: (sessionId: string) => void;
  onRunBuiltin: (id: BuiltinCommandId) => void;
  onNewTask: () => void;
  onNewAssistant: () => void;
  onOpenWorkspace: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  /** 展开 / 收起工作台（右侧第三栏） */
  onToggleWorkbench: () => void;
  /** 打开文件：交给上层的工作台预览器 */
  onOpenFile: (path: string) => void;
};

/** 每个分类最多展示的条数，避免长列表淹没其他分类 */
const GROUP_LIMIT = 20;

/** 会话过滤：标题或预览命中；空查询出最近的若干条 */
const matchSessions = (sessions: SessionSummary[], fallback: string, query: string) => {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? sessions.filter(
        (session) =>
          sessionTitle(session, fallback).toLowerCase().includes(needle) ||
          session.preview.toLowerCase().includes(needle),
      )
    : sessions;
  return matched.slice(0, GROUP_LIMIT);
};

export function CommandPalette({
  open,
  onOpenChange,
  sessions,
  fileRoot,
  hasSession,
  onSelectSession,
  onRunBuiltin,
  onNewTask,
  onNewAssistant,
  onOpenWorkspace,
  onOpenSettings,
  onToggleSidebar,
  onToggleWorkbench,
  onOpenFile,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  /** 内置命令的 descriptionKey 是普通字符串，窄化 t 以按 key 取文案 */
  const translate = t as (key: string) => string;
  const client = useClient();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [files, setFiles] = useState<FsEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 每次打开都回到默认状态
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTab("all");
    setActiveIndex(0);
  }, [open]);

  // 文件检索：输入停顿后按根目录搜索，空查询不出文件
  useEffect(() => {
    if (!open || !fileRoot || tab === "tasks" || tab === "actions") {
      setFiles([]);
      return;
    }
    const q = query.trim();
    if (!q) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setFilesLoading(true);
      void client.apis.fs
        .search({ path: fileRoot, q })
        .then((result) => {
          if (!cancelled) setFiles(result.entries);
        })
        .catch(() => {
          if (!cancelled) setFiles([]);
        })
        .finally(() => {
          if (!cancelled) setFilesLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, fileRoot, query, tab, client]);

  // 查询 / 分类变化后把高亮复位到第一条
  useEffect(() => setActiveIndex(0), [query, tab]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const needle = query.trim().toLowerCase();

    const operations: PaletteItem[] = [
      {
        id: "op:new",
        label: t("新建任务"),
        icon: CirclePlus,
        shortcut: `${MOD_KEY_LABEL}N`,
        run: onNewTask,
      },
      { id: "op:assistant", label: t("小助理"), icon: Sparkles, run: onNewAssistant },
      {
        id: "op:workspace",
        label: t("打开工作区"),
        icon: FileIcon,
        shortcut: `${MOD_KEY_LABEL}O`,
        run: onOpenWorkspace,
      },
      { id: "op:settings", label: t("设置"), icon: Settings2, run: onOpenSettings },
      {
        id: "op:workbench",
        label: t("切换工作台"),
        hint: t("改动 / 文件"),
        icon: PanelsTopLeft,
        run: onToggleWorkbench,
      },
      {
        id: "op:sidebar",
        label: t("切换侧边栏"),
        icon: PanelLeft,
        shortcut: `${MOD_KEY_LABEL}B`,
        run: onToggleSidebar,
      },
    ].filter((item) => !needle || item.label.toLowerCase().includes(needle));

    const builtins: PaletteItem[] = BUILTIN_COMMANDS.filter(
      (command) =>
        (!command.needsSession || hasSession) &&
        (!needle ||
          command.name.includes(needle) ||
          translate(command.descriptionKey).toLowerCase().includes(needle)),
    ).map((command) => ({
      id: `builtin:${command.id}`,
      label: `/${command.name}`,
      hint: translate(command.descriptionKey),
      icon: Terminal,
      run: () => onRunBuiltin(command.id),
    }));

    const tasks: PaletteItem[] = matchSessions(sessions, t("新会话"), query).map((session) => ({
      id: `task:${session.id}`,
      label: sessionTitle(session, t("新会话")),
      hint: relativeTimeLabel(session.updatedAt),
      icon: MessageSquare,
      run: () => onSelectSession(session.id),
    }));

    const fileItems: PaletteItem[] = files.slice(0, GROUP_LIMIT).map((entry) => ({
      id: `file:${entry.path}`,
      label: entry.name,
      hint: entry.path,
      icon: FileIcon,
      run: () => onOpenFile(entry.path),
    }));

    const all: Array<PaletteGroup & { id: PaletteGroupId }> = [
      { id: "actions", title: t("操作"), items: operations },
      { id: "commands", title: t("命令"), items: builtins },
      { id: "tasks", title: t("任务"), items: tasks },
      { id: "files", title: t("文件"), items: fileItems },
    ];
    if (tab === "all") return all;
    const wanted: Record<Exclude<PaletteTab, "all">, PaletteGroupId[]> = {
      actions: ["actions", "commands"],
      tasks: ["tasks"],
      files: ["files"],
    };
    return all.filter((group) => wanted[tab].includes(group.id));
  }, [
    query,
    tab,
    files,
    sessions,
    t,
    translate,
    hasSession,
    onNewTask,
    onNewAssistant,
    onOpenWorkspace,
    onOpenSettings,
    onToggleSidebar,
    onToggleWorkbench,
    onRunBuiltin,
    onSelectSession,
    onOpenFile,
  ]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // 高亮项变化时把它滚进可视区
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const select = (item: PaletteItem) => {
    onOpenChange(false);
    item.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (flat.length === 0 ? 0 : (prev + 1) % flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (flat.length === 0 ? 0 : (prev - 1 + flat.length) % flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[activeIndex];
      if (item) select(item);
    }
  };

  const tabs: Array<{ id: PaletteTab; label: string; icon: LucideIcon }> = [
    { id: "all", label: t("全部"), icon: List },
    { id: "actions", label: t("操作"), icon: Terminal },
    { id: "tasks", label: t("任务"), icon: MessageSquare },
    { id: "files", label: t("文件"), icon: FileIcon },
  ];

  let cursor = 0;
  const empty = flat.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t("搜索")}</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("搜索操作、任务或文件")}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex items-center gap-1 px-2 py-1.5">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none transition-colors",
                tab === item.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto px-1 pb-1">
          {empty ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {filesLoading ? t("搜索中…") : t("无匹配结果")}
            </p>
          ) : null}

          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.id} className="py-0.5">
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.title}</p>
                {group.items.map((item) => {
                  const index = cursor++;
                  const active = index === activeIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={index}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(item)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none",
                        active ? "bg-accent" : "hover:bg-accent/60",
                      )}
                    >
                      <item.icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hint ? (
                        <span className="max-w-[45%] min-w-0 shrink-0 truncate text-xs text-muted-foreground">
                          {item.hint}
                        </span>
                      ) : null}
                      {item.shortcut ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.shortcut}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ),
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
