import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, describeError } from "../lib/api";
import type { ModelsResponse } from "../lib/types";

/** 模型目录：初值加载 + 手动重建运行时。加载态由调用处按 data 是否为空自行表达 */
export function useModels() {
  const { t } = useTranslation();
  const [data, setData] = useState<ModelsResponse | null>(null);

  /** 失败时保留上一次的 data，只弹提示，避免配置页被清空 */
  const run = useCallback(
    async (action: () => Promise<ModelsResponse>, failure: string) => {
      try {
        setData(await action());
      } catch (error) {
        toast.error(t("失败提示.模板", { label: failure, reason: describeError(error) }));
      }
    },
    [t],
  );

  const reload = useCallback(() => run(() => api.models.list(), t("模型列表加载失败")), [run, t]);

  const refresh = useCallback(() => run(() => api.models.refresh(), t("重建运行时失败")), [run, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, reload, refresh };
}
