/** 会话列表与动作的组合入口 */
import { useSessionActions } from "@/hooks/use-session-actions";
import { useSessionList } from "@/hooks/use-session-list";

export function useSessions() {
  const list = useSessionList();
  const actions = useSessionActions(list);
  return { ...list, ...actions };
}
