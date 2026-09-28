import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ApiRequestError, api } from "@/lib/api";
import type { ModelsResponse } from "@/lib/types";

export function useModels() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.models.list());
    } catch (error) {
      toast.error(
        `模型列表加载失败：${error instanceof ApiRequestError ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.models.refresh());
    } catch (error) {
      toast.error(
        `重建运行时失败：${error instanceof ApiRequestError ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, reload, refresh };
}
