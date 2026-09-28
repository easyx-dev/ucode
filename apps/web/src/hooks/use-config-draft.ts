/** 模型设置的草稿状态：读取当前配置，组合 provider 级与模型级编辑 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfigModels } from "@/hooks/use-config-models";
import { api, describeError } from "@/lib/api";
import {
  createDraftProvider,
  type DraftProvider,
  modelOptions,
  toDraftProvider,
} from "@/lib/config-draft";
import type { ThinkingLevel } from "@/lib/types";

export type ConfigDraft = ReturnType<typeof useConfigDraft>;

export function useConfigDraft(open: boolean) {
  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("off");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { config } = await api.config.info();
      setProviders(config.providers.map(toDraftProvider));
      setDefaultModel(config.defaultModel ?? "");
      setThinkingLevel(config.thinkingLevel);
    } catch (error) {
      toast.error(`配置加载失败：${describeError(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const patchProvider = useCallback(
    (key: string, patch: Partial<DraftProvider>) => {
      setProviders((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    },
    [setProviders],
  );

  const addProvider = useCallback(() => {
    setProviders((prev) => [...prev, createDraftProvider()]);
  }, []);

  const removeProvider = useCallback((key: string) => {
    setProviders((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const models = useConfigModels(setProviders);
  const options = useMemo(() => modelOptions(providers), [providers]);

  return {
    providers,
    defaultModel,
    thinkingLevel,
    loading,
    options,
    setDefaultModel,
    setThinkingLevel,
    patchProvider,
    addProvider,
    removeProvider,
    ...models,
  };
}
