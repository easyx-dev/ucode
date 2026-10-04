/** 运行时状态：目前只用于取 agent 工作目录，展示在空态文案里 */
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { HealthResponse } from "../lib/types";

export function useHealth(): HealthResponse | null {
  const [data, setData] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 取不到时保持 null，由使用方回落到通用文案，不打断主流程
    api
      .health()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
