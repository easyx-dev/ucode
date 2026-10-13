/** 输入区与消息编辑态共用的 `@` 候选：检索会话工作目录，映射成建议项 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useClient } from "../../../provider";
import type { SuggestionItem } from "./suggestion";

/** 候选条数上限：两端同量级即可，不必按面板高度精算 */
export const MAX_CONTEXT_ITEMS = 20;

/** 没有工作目录（还没定 cwd 的草稿、编辑态拿不到会话目录）时给空候选 */
export const useContextItems = (
  cwd: string | null | undefined,
): ((query: string) => Promise<SuggestionItem[]>) => {
  const client = useClient();
  const { t } = useTranslation();

  return useCallback(
    async (query: string): Promise<SuggestionItem[]> => {
      if (!cwd) return [];
      try {
        const result = await client.apis.fs.search({
          path: cwd,
          q: query,
          limit: MAX_CONTEXT_ITEMS,
        });
        return result.entries.map((entry) => ({
          id: entry.path,
          label: entry.type === "directory" ? `${entry.name}/` : entry.name,
          hint: entry.path,
          group: t("文件"),
          path: entry.path,
        }));
      } catch {
        return [];
      }
    },
    [client, cwd, t],
  );
};
