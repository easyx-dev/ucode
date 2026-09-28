/** 模型设置对话框的表单主体：provider 列表 + 全局默认值 */
import { Loader2, Plus } from "lucide-react";

import { ProviderCard } from "@/components/settings/provider-card";
import { SettingsDefaults } from "@/components/settings/settings-defaults";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ConfigDraft } from "@/hooks/use-config-draft";
import type { DraftProvider } from "@/lib/config-draft";

type SettingsBodyProps = {
  draft: ConfigDraft;
  /** 正在测试连通性的 provider key */
  testingKey: string | null;
  onTest: (provider: DraftProvider) => void;
};

export function SettingsBody({ draft, testingKey, onTest }: SettingsBodyProps) {
  return (
    <div className="space-y-4 py-1">
      {draft.loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载中…
        </div>
      ) : null}

      {!draft.loading && draft.providers.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          还没有配置 provider，点击下面「添加 provider」。
        </p>
      ) : null}

      {draft.providers.map((provider) => (
        <ProviderCard
          key={provider.key}
          provider={provider}
          testing={testingKey === provider.key}
          onPatch={(patch) => draft.patchProvider(provider.key, patch)}
          onModelPatch={(modelKey, patch) => draft.patchModel(provider.key, modelKey, patch)}
          onAddModel={() => draft.addModel(provider.key)}
          onRemoveModel={(modelKey) => draft.removeModel(provider.key, modelKey)}
          onRemove={() => draft.removeProvider(provider.key)}
          onTest={() => onTest(provider)}
        />
      ))}

      <Button variant="outline" onClick={draft.addProvider}>
        <Plus className="size-4" />
        添加 provider
      </Button>

      <Separator />

      <SettingsDefaults
        options={draft.options}
        defaultModel={draft.defaultModel}
        thinkingLevel={draft.thinkingLevel}
        onSelectDefaultModel={draft.setDefaultModel}
        onSelectThinkingLevel={draft.setThinkingLevel}
      />
    </div>
  );
}
