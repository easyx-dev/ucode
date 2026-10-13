/** 「拉取模型列表」动作：按 provider 表单里的端点与 key 请求上游 `/models`，结果留在本地供列表选择 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useClient } from "../../../provider";
import type { ProviderModelsResponse } from "../../../types";
import { errorText } from "../../../utils/error-text";
import type { DraftProvider } from "../config-draft";

export type ProviderModelFetch = {
  fetching: boolean;
  /** 最近一次拉取的结果；未拉取过或已丢弃时为 null */
  result: ProviderModelsResponse | null;
  /** 前置校验不通过时只提示，不发请求 */
  fetch: (provider: DraftProvider) => Promise<void>;
  /** 丢弃结果（收起列表时调用） */
  discard: () => void;
};

export function useProviderModelFetch(): ProviderModelFetch {
  const { t } = useTranslation();
  const client = useClient();
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<ProviderModelsResponse | null>(null);

  const fetch = async (provider: DraftProvider): Promise<void> => {
    // 自定义供应商以表单值为准；不用 resolvedBaseUrl 兜底——
    // 清空表单只是想换地址，拿加载时的快照去请求会让人把旧端点的结果当成新端点的
    const baseUrl = provider.baseUrl.trim();
    if (!baseUrl) {
      toast.error(t("先填写 baseUrl 再拉取模型列表"));
      return;
    }
    // apiKeyMasked 非空说明配置里已存过 key，服务端会按 providerId 回落到它
    if (!provider.apiKey.trim() && !provider.apiKeyMasked) {
      toast.error(t("该供应商还没有 apiKey，先填写或保存一个再拉取"));
      return;
    }

    setFetching(true);
    setResult(null);
    try {
      const response = await client.apis.config.fetchModels({
        baseUrl,
        api: provider.api,
        ...(provider.id.trim() ? { providerId: provider.id.trim() } : {}),
        ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
      });
      setResult(response);
    } catch (error) {
      // 走的是接口调用而非 store，失败提示得在这里给出（ErrorToaster 只管 store 状态）
      toast.error(errorText(t, error));
    } finally {
      setFetching(false);
    }
  };

  const discard = (): void => setResult(null);

  return { fetching, result, fetch, discard };
}
