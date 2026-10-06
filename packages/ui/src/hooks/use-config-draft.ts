/**
 * 模型设置的草稿状态：数据来自 config / models store，抽屉打开时加载并在数据到达后填充草稿。
 *
 * 草稿一旦填充即由用户接管，后续 store 更新不再覆盖，避免打断未保存的编辑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  catalogToDraftProvider,
  createDraftProvider,
  type DraftProvider,
  type DraftWebsearch,
  modelOptions,
  toDraftProvider,
  toDraftWebsearch,
} from "../lib/config-draft";
import type { CatalogProvider, ThinkingLevel } from "../lib/types";
import { DEFAULT_SEARCH_PROVIDER } from "../lib/types";
import { useClient } from "../provider";
import { useConfigModels } from "./use-config-models";
import { useStore } from "./use-store";

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
  const client = useClient();
  const configState = useStore(client.config);
  const modelsState = useStore(client.models);

  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("off");
  const [websearch, setWebsearch] = useState<DraftWebsearch>(emptyWebsearch);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  /** 本次打开是否已用服务端配置填充过草稿 */
  const seeded = useRef(false);

  // 打开时拉取「已保存了什么」与「pi 还支持什么」；关闭后重置填充标记
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    void client.config.load();
    void client.models.reload();
  }, [client, open]);

  useEffect(() => {
    const snapshot = configState.data;
    // 目录未就绪（既无数据也无错误）时先不 seed：内置供应商要靠目录判定 source，
    // 否则会被当成自定义、保存时误报缺 baseUrl
    const modelsSettled = modelsState.data !== null || modelsState.error !== null;
    if (!open || seeded.current || !snapshot || !modelsSettled) return;
    seeded.current = true;
    const directory = modelsState.data?.providers ?? [];
    const { config } = snapshot;
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
    setMemoryEnabled(config.memory.enabled);
  }, [configState.data, modelsState.data, modelsState.error, open]);

  const patchProvider = useCallback((key: string, patch: Partial<DraftProvider>) => {
    setProviders((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  /** 新加一条自定义供应商，返回它的草稿 key 以便选中 */
  const addProvider = useCallback((): string => {
    const provider = createDraftProvider();
    setProviders((prev) => [...prev, provider]);
    return provider.key;
  }, []);

  /** 从 pi 目录接入一个内置供应商（只差一个 apiKey），返回草稿 key；目录里找不到时返回 null */
  const addFromCatalog = useCallback(
    (providerId: string): string | null => {
      const entry = catalog.find((item) => item.id === providerId);
      if (!entry) return null;
      const provider = catalogToDraftProvider(entry);
      setProviders((prev) => [
        ...prev.filter((item) => item.id !== providerId || item.source !== "builtin"),
        provider,
      ]);
      return provider.key;
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
    memoryEnabled,
    loading: configState.loading,
    options,
    setDefaultModel,
    setThinkingLevel,
    patchProvider,
    addProvider,
    addFromCatalog,
    removeProvider,
    patchWebsearch,
    setMemoryEnabled,
    ...models,
  };
}
