/** MCP 服务器列表：初次挂载加载，增删改后重取；操作失败弹提示并保留上一次数据 */
import type { McpListResponse, McpUpsertRequest } from "@ucode/contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, describeError } from "../lib/api";

export function useMcpServers() {
  const { t } = useTranslation();
  const [data, setData] = useState<McpListResponse | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.mcp.list());
    } catch (error) {
      toast.error(
        t("失败提示.模板", {
          label: t("MCP 服务器加载失败"),
          reason: describeError(error),
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const upsert = useCallback(
    async (input: McpUpsertRequest): Promise<boolean> => {
      try {
        await api.mcp.upsert(input);
        await load();
        return true;
      } catch (error) {
        toast.error(
          t("失败提示.模板", {
            label: t("MCP 服务器保存失败"),
            reason: describeError(error),
          }),
        );
        return false;
      }
    },
    [load, t],
  );

  const remove = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await api.mcp.remove(name);
        await load();
        return true;
      } catch (error) {
        toast.error(
          t("失败提示.模板", {
            label: t("MCP 服务器删除失败"),
            reason: describeError(error),
          }),
        );
        return false;
      }
    },
    [load, t],
  );

  return { data, upsert, remove };
}
