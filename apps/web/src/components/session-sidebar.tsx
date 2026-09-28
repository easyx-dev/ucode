import { MessageSquarePlus, MoreHorizontal, Pencil, Search, Settings2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { sessionTitle } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/lib/types";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  activeId: string | null;
  loading: boolean;
  configured: boolean;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onRename: (sessionId: string, name: string) => void;
  onDelete: (sessionId: string) => void;
  onOpenSettings: () => void;
};

const titleOf = (session: SessionSummary): string => sessionTitle(session);

export function SessionSidebar({
  sessions,
  activeId,
  loading,
  configured,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onOpenSettings,
}: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (session) =>
        titleOf(session).toLowerCase().includes(needle) ||
        session.preview.toLowerCase().includes(needle) ||
        session.id.toLowerCase().includes(needle),
    );
  }, [query, sessions]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="text-sm font-semibold tracking-tight">ucode</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onCreate}
          disabled={!configured}
          title="新建会话"
        >
          <MessageSquarePlus className="size-4" />
          新建
        </Button>
      </div>

      <div className="relative px-3 pb-2">
        <Search className="absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索会话"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 px-2 pb-3">
          {loading && sessions.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">加载中…</p>
          ) : null}

          {!loading && filtered.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">暂无会话</p>
          ) : null}

          {filtered.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5",
                session.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelect(session.id)}
              >
                <div className="truncate text-xs font-medium">{titleOf(session)}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{session.messageCount} 条</span>
                  {session.model ? <Badge variant="secondary" className="h-4 px-1 text-[9px]">{session.model.split("/").pop()}</Badge> : null}
                </div>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 group-hover:opacity-100"
                    title="更多"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setRenaming({ id: session.id, name: titleOf(session) })}
                  >
                    <Pencil className="size-3.5" />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm(`删除会话「${titleOf(session)}」？该操作不可撤销。`)) {
                        onDelete(session.id);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          模型设置
        </Button>
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renaming?.name ?? ""}
            onChange={(event) =>
              setRenaming((prev) => (prev ? { ...prev, name: event.target.value } : prev))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && renaming?.name.trim()) {
                onRename(renaming.id, renaming.name.trim());
                setRenaming(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              disabled={!renaming?.name.trim()}
              onClick={() => {
                if (renaming?.name.trim()) {
                  onRename(renaming.id, renaming.name.trim());
                  setRenaming(null);
                }
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
