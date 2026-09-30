/** 模型设置的草稿状态：读取当前配置与 pi 供应商目录，组合 provider 级与模型级编辑 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useConfigModels } from "@/hooks/use-config-models";
import { api, describeError } from "@/lib/api";
import type { DraftProvider, DraftWebsearch } from "@/lib/config-draft";
import {
  createDraftProvider,
  fromCatalogProvider,
  modelOptions,
  toDraftProvider,
  toDraftWebsearch,
} from "@/lib/config-draft";
import { type CatalogProvider, DEFAULT_SEARCH_PROVIDER, type ThinkingLevel } from "@/lib/types";

/** 联网搜索草稿的初值：与契约的默认值保持一致 */
const emptyWebsearch = (): DraftWebsearch => ({
  provider: DEFAULT_SEARCH_PROVIDER,
  apiKey: "",
  apiKeyMasked: "",
  baseUrl: "",
  configured: false,
});

export type ConfigDraft = ReturnType<typeof useConfigDraft>;

export function useConfigDraft(open: boolean) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("off");
  const [websearch, setWebsearch] = useState<DraftWebsearch>(emptyWebsearch);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 配置给出「已保存了什么」，目录给出「pi 还支持什么」，两者一起才够渲染
      const [{ config }, models] = await Promise.all([api.config.info(), api.models.list()]);
      const directory = models.providers;
      setCatalog(directory);
      setProviders(
        config.providers.map((provider) =>
          toDraftProvider(
            provider,
            directory.find((item) => item.id === provider.id),
          ),
        ),
      );
      setDefaultModel(config.defaultModel ?? "");
      setThinkingLevel(config.thinkingLevel);
      setWebsearch(toDraftWebsearch(config.websearch));
    } catch (error) {
      toast.error(t("失败提示", { label: t("配置加载失败"), reason: describeError(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  /**
   * 语言切换只该换文案：`load` 的依赖含 `t`，若让 effect 直接依赖它，切语言会重跑 `load`，
   * 用服务端配置覆盖对话框里未保存的草稿。改成只在 `open` 变化时触发，`load` 走 ref。
   */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (open) void loadRef.current();
  }, [open]);

  const patchProvider = useCallback(
    (key: string, patch: Partial<DraftProvider>) => {
      setProviders((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    },
    [setProviders],
  );

  const addProvider = useCallback(() => {
    setProviders((prev) => [...prev, createDraftProvider()]);
  }, []);

  /** 从 pi 目录接入一个内置供应商：只差一个 apiKey */
  const addFromCatalog = useCallback(
    (providerId: string) => {
      const entry = catalog.find((item) => item.id === providerId);
      if (!entry) return;
      setProviders((prev) => [
        ...prev.filter((item) => item.id !== providerId || item.source !== "builtin"),
        fromCatalogProvider(entry),
      ]);
    },
    [catalog],
  );

  const removeProvider = useCallback((key: string) => {
    setProviders((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const patchWebsearch = useCallback((patch: Partial<DraftWebsearch>) => {
    setWebsearch((prev) => ({ ...prev, ...patch }));
  }, []);

  const models = useConfigModels(setProviders);
  const options = useMemo(() => modelOptions(providers), [providers]);
  /** 已接入（配置里已有）的目录条目 id，用于在目录里做标记 */
  const configuredIds = useMemo(
    () => new Set(providers.map((item) => item.id.trim())),
    [providers],
  );

  return {
    providers,
    catalog,
    configuredIds,
    defaultModel,
    thinkingLevel,
    websearch,
    loading,
    options,
    setDefaultModel,
    setThinkingLevel,
    patchProvider,
    addProvider,
    addFromCatalog,
    removeProvider,
    patchWebsearch,
    ...models,
  };
}
