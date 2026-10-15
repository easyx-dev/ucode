/**
 * 浏览器 profile 的数据面：列举与删除。
 *
 * 数据在服务端磁盘上（`$APP_HOME/app/browser/profiles/<name>`），不随配置草稿走——
 * 关闭设置页不丢，删除即时生效，所以这里自管取数与重取，不进 `useConfigDraft`。
 */
import type { BrowserDeleteResponse, BrowserProfileView } from "@ucode/contracts";
import { useCallback, useState } from "react";
import { useAsyncData } from "../../../hooks/use-async-data";
import { useClient } from "../../../provider";

export type BrowserProfilesState = {
  profiles: BrowserProfileView[] | null;
  root: string;
  limits: { maxProfiles: number; maxBytes: number } | null;
  loading: boolean;
  error: unknown;
  deleting: boolean;
  reload: () => void;
  /** 删除若干份；返回服务端的分项结果（使用中的会被跳过） */
  remove: (names: string[]) => Promise<BrowserDeleteResponse | null>;
};

export function useBrowserProfiles(): BrowserProfilesState {
  const client = useClient();
  const [reloadToken, setReloadToken] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const state = useAsyncData("browser-profiles", () => client.apis.browser.list({}), reloadToken);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const remove = useCallback(
    async (names: string[]): Promise<BrowserDeleteResponse | null> => {
      if (names.length === 0) return null;
      setDeleting(true);
      try {
        const result = await client.apis.browser.delete({ names });
        reload();
        return result;
      } finally {
        setDeleting(false);
      }
    },
    [client, reload],
  );

  const data = state.data;
  return {
    profiles: data?.profiles ?? null,
    root: data?.root ?? "",
    limits: data?.limits ?? null,
    loading: state.loading,
    error: state.error,
    deleting,
    reload,
    remove,
  };
}
