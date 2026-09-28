/** 侧栏的会话列表区域：加载态、空态与逐条渲染 */
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
  return (
    <ScrollArea className="flex-1">
      <div className="space-y-1 px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">加载中…</p>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">暂无会话</p>
        ) : null}

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
    </ScrollArea>
  );
}
