/** 全局使用统计：对话框打开或切换时间范围时取一次 */
import { useEffect, useState } from "react";

import { api, describeError } from "../lib/api";
import type { StatsSummaryResponse } from "../lib/types";

export function useUsage(
  open: boolean,
  days: number | undefined,
): { data: StatsSummaryResponse | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<StatsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.stats
      .summary(days ? { days } : {})
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, days]);

  return { data, loading, error };
}
