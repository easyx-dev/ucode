/** 模型设置的两个动作：提交配置、测试 provider 连通性 */
import { useState } from "react";
import { toast } from "sonner";
import type { ConfigDraft } from "@/hooks/use-config-draft";
import { api, describeError } from "@/lib/api";
import { type DraftProvider, toUpdatePayload } from "@/lib/config-draft";

export type ConfigSave = {
  saving: boolean;
  /** 正在测试连通性的 provider key */
  testingKey: string | null;
  /** 返回是否保存成功（成功后调用方可关闭对话框） */
  save: () => Promise<boolean>;
  test: (provider: DraftProvider) => Promise<void>;
};

export function useConfigSave(draft: ConfigDraft, onSaved: () => void): ConfigSave {
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await api.config.update(
        toUpdatePayload(draft.providers, draft.defaultModel || null, draft.thinkingLevel),
      );
      toast.success("配置已保存");
      onSaved();
      return true;
    } catch (error) {
      toast.error(`保存失败：${describeError(error)}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider: DraftProvider): Promise<void> => {
    const model = provider.models[0]?.id.trim();
    if (!provider.baseUrl.trim() || !model) {
      toast.error("先填写 baseUrl 和至少一个模型 id");
      return;
    }

    setTestingKey(provider.key);
    try {
      const result = await api.config.test({
        baseUrl: provider.baseUrl.trim(),
        providerId: provider.id.trim() || undefined,
        ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
        api: provider.api,
        model,
      });
      toast.success(`连接成功 · ${result.latencyMs}ms · ${result.modelEcho ?? "-"}`);
    } catch (error) {
      toast.error(`连接失败：${describeError(error)}`);
    } finally {
      setTestingKey(null);
    }
  };

  return { saving, testingKey, save, test };
}
