/** 模型设置的两个动作：提交配置、测试 provider 连通性 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type DraftProvider, toUpdatePayload, validateDrafts } from "../lib/config-draft";
import { useClient } from "../provider";
import type { ConfigDraft } from "./use-config-draft";

export type ConfigSave = {
  saving: boolean;
  /** 正在测试连通性的 provider key */
  testingKey: string | null;
  /** 返回是否保存成功（成功后调用方可关闭对话框） */
  save: () => Promise<boolean>;
  test: (provider: DraftProvider) => Promise<void>;
};

export function useConfigSave(draft: ConfigDraft, onSaved: () => void): ConfigSave {
  const { t } = useTranslation();
  const client = useClient();
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  const save = async (): Promise<boolean> => {
    const invalid = validateDrafts(draft.providers, t);
    if (invalid) {
      toast.error(invalid);
      return false;
    }

    setSaving(true);
    try {
      const saved = await client.config.update(
        toUpdatePayload(
          draft.providers,
          draft.defaultModel || null,
          draft.thinkingLevel,
          draft.websearch,
          draft.memoryEnabled,
        ),
      );
      // 失败原因由 ErrorToaster 统一提示，这里只报成功
      if (saved) {
        toast.success(t("配置已保存"));
        onSaved();
      }
      return saved;
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider: DraftProvider): Promise<void> => {
    const model = provider.inheritedModels[0]?.id ?? provider.models[0]?.id.trim();
    // 自定义供应商以表单值为准（resolvedBaseUrl 是加载时的快照），内置供应商回落到目录端点
    const baseUrl = provider.baseUrl.trim() || provider.resolvedBaseUrl.trim();
    if (!baseUrl || !model) {
      toast.error(t("先填写 baseUrl 和至少一个模型 id"));
      return;
    }

    setTestingKey(provider.key);
    try {
      const result = await client.config.test({
        baseUrl,
        providerId: provider.id.trim() || undefined,
        ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
        api: provider.api,
        model,
      });
      if (result) {
        toast.success(
          t("连接成功 · {{latency}}ms · {{model}}", {
            latency: result.latencyMs,
            model: result.modelEcho ?? "-",
          }),
        );
      }
    } finally {
      setTestingKey(null);
    }
  };

  return { saving, testingKey, save, test };
}
