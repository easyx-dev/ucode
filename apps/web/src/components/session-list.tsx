/** 侧栏的会话列表区域：分组标签、加载态、空态与逐条渲染 */
import { SessionListItem } from "@/components/session-list-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionSummary } from "@/lib/types";

type SessionListProps = {
  sessions: SessionSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (sessionId: string) => void;
  onRename: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
};

export function SessionList({
  sessions,
  activeId,
  loading,
  onSelect,
  onRename,
  onDelete,
}: SessionListProps) {
  const empty = !loading && sessions.length === 0;

  return (
    <ScrollArea className="flex-1">
      <div className="px-2 pb-3">
        <h2 className="px-2 py-1.5 text-xs font-medium text-muted-foreground">会话</h2>

        {loading && sessions.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">加载中…</p>
        ) : null}

        {empty ? <p className="px-2 py-2 text-xs text-muted-foreground">暂无会话</p> : null}

        <div className="space-y-0.5">
          {sessions.map((session) => (
            <SessionListItem
              key={session.id}
              session={session}
              active={session.id === activeId}
              onSelect={() => onSelect(session.id)}
              onRename={() => onRename(session)}
              onDelete={() => onDelete(session)}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
