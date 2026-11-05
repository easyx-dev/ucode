/**
 * 记忆设置页的状态：项目级记忆的清单、逐条正文，以及改 / 删两条写入动作，页面只管渲染。
 *
 * 清单来自 `memory/list`（一次请求，磁盘扫描在服务端做）；正文按需拉，取过就缓存——
 * 展开收起是纯展示动作，不该每次都重新读盘。改完重取一次清单：标题与描述都在索引行里，
 * 只改本地缓存的话列表会与磁盘上的 `MEMORY.md` 对不上。
 *
 * 新增记忆不在这里：那是模型侧的事（「记住」与每轮结束后的自动回顾）。
 */
import type { MemoryFactView, MemoryListResponse } from "@ucode/contracts";
import { type ApiError, asApiError } from "@ucode/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useClient } from "../../../provider";
import { errorText } from "../../../utils/error-text";
import type { MemoryFactDraft } from "./memory-edit-dialog";

/** 一条记忆的键：目录 + 文件名，列表与缓存共用 */
const keyOf = (dir: string, file: string): string => `${dir}\u0000${file}`;

export type MemoryLibrary = {
  /** 最近一次取到的清单；null 表示还没取到（页面据此显示加载态） */
  data: MemoryListResponse | null;
  /**
   * 取清单失败的原因。失败不能退化成空清单——「读不到」与「没有记忆」在这里是两件事，
   * 混成一句「还没有项目记忆」会让人以为记忆丢了。
   */
  error: ApiError | null;
  /** 重新取一次清单（错误态的重试入口） */
  reload: () => void;
  /** 已取回的正文，按 `dir + file` 索引 */
  facts: Record<string, MemoryFactView>;
  /** 同一时刻只有一条在取正文，页面据此显示该条的行内加载态 */
  loadingKey: string | null;
  /** 取一条正文（缓存优先）；失败返回 null */
  loadFact: (dir: string, file: string) => Promise<MemoryFactView | null>;
  /** 改一条：成功后正文进缓存并重取清单；失败弹轻提示 */
  saveFact: (dir: string, file: string, draft: MemoryFactDraft) => Promise<boolean>;
  /** 删一条：成功后丢掉缓存并重取清单；失败弹轻提示 */
  removeFact: (dir: string, file: string) => Promise<boolean>;
};

export function useMemoryLibrary(): MemoryLibrary {
  const { t } = useTranslation();
  const client = useClient();
  const [data, setData] = useState<MemoryListResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [facts, setFacts] = useState<Record<string, MemoryFactView>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  /** 缓存的最新副本：`loadFact` 要按需读它，而回调不该因为 `facts` 变化就换引用 */
  const factsRef = useRef(facts);

  const commitFacts = useCallback((next: Record<string, MemoryFactView>) => {
    factsRef.current = next;
    setFacts(next);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await client.apis.memory.list());
      setError(null);
    } catch (failure) {
      setError(asApiError(failure));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadFact = useCallback(
    async (dir: string, file: string): Promise<MemoryFactView | null> => {
      const key = keyOf(dir, file);
      const cached = factsRef.current[key];
      if (cached) return cached;

      setLoadingKey(key);
      try {
        const fact = await client.apis.memory.read({ dir, file });
        commitFacts({ ...factsRef.current, [key]: fact });
        return fact;
      } catch {
        return null;
      } finally {
        setLoadingKey((current) => (current === key ? null : current));
      }
    },
    [client, commitFacts],
  );

  const saveFact = useCallback(
    async (dir: string, file: string, draft: MemoryFactDraft): Promise<boolean> => {
      try {
        const fact = await client.apis.memory.update({ dir, file, ...draft });
        commitFacts({ ...factsRef.current, [keyOf(dir, file)]: fact });
        await load();
        return true;
      } catch (error) {
        toast.error(errorText(t, error));
        return false;
      }
    },
    [client, commitFacts, load, t],
  );

  const removeFact = useCallback(
    async (dir: string, file: string): Promise<boolean> => {
      try {
        await client.apis.memory.remove({ dir, file });
        const { [keyOf(dir, file)]: _dropped, ...rest } = factsRef.current;
        commitFacts(rest);
        await load();
        return true;
      } catch (error) {
        toast.error(errorText(t, error));
        return false;
      }
    },
    [client, commitFacts, load, t],
  );

  return {
    data,
    error,
    reload: () => void load(),
    facts,
    loadingKey,
    loadFact,
    saveFact,
    removeFact,
  };
}

export { keyOf as memoryFactKey };
