/** 模型设置的两个动作：提交配置、测试 provider 连通性 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, describeError } from "../lib/api";
import { type DraftProvider, toUpdatePayload, validateDrafts } from "../lib/config-draft";
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
      await api.config.update(
        toUpdatePayload(
          draft.providers,
          draft.defaultModel || null,
          draft.thinkingLevel,
          draft.websearch,
          draft.memoryEnabled,
        ),
      );
      toast.success(t("配置已保存"));
      onSaved();
      return true;
    } catch (error) {
      toast.error(t("失败提示.模板", { label: t("保存失败"), reason: describeError(error) }));
      return false;
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
      const result = await api.config.test({
        baseUrl,
        providerId: provider.id.trim() || undefined,
        ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
        api: provider.api,
        model,
      });
      toast.success(
        t("连接成功 · {{latency}}ms · {{model}}", {
          latency: result.latencyMs,
          model: result.modelEcho ?? "-",
        }),
      );
    } catch (error) {
      toast.error(t("失败提示.模板", { label: t("连接失败"), reason: describeError(error) }));
    } finally {
      setTestingKey(null);
    }
  };

  return { saving, testingKey, save, test };
}
