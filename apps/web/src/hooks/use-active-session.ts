/** 当前选中的会话：默认选中最近一个，会话从列表消失时清空 */
import { useEffect, useState } from "react";

import type { SessionSummary } from "@/lib/types";

export function useActiveSession(sessions: SessionSummary[]) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (activeId !== null) return;
    const first = sessions[0];
    if (first) setActiveId(first.id);
  }, [activeId, sessions]);

  useEffect(() => {
    if (activeId && !sessions.some((item) => item.id === activeId)) setActiveId(null);
  }, [activeId, sessions]);

  return { activeId, setActiveId };
}
