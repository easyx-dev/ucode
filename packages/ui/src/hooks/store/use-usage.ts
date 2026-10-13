/** 全局使用统计的 React 绑定：对话框打开或切换时间范围时取一次 */
import type { StatsSummaryResponse } from "@ucode/contracts";
import { useEffect } from "react";
import { useClient } from "../../provider";
import { useErrorText } from "../use-error-text";
import { useStore } from "../use-store";

export function useUsage(
  open: boolean,
  days: number | undefined,
): { data: StatsSummaryResponse | null; loading: boolean; error: string | null } {
  const client = useClient();
  const state = useStore(client.usage);
  const error = useErrorText(state.error);

  useEffect(() => {
    if (open) void client.usage.loadStats(days);
  }, [client, days, open]);

  return { data: state.stats, loading: state.statsLoading, error };
}
