/** 设置对话框的表单主体：外观 / 模型供应商 / 联网搜索 / 全局默认值 */
import { Loader2, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Separator } from "../../base/separator";
import type { ConfigDraft } from "../../hooks/use-config-draft";
import type { DraftProvider } from "../../lib/config-draft";
import { ProviderCard } from "./provider-card";
import { ProviderCatalog } from "./provider-catalog";
import { SettingsAppearance } from "./settings-appearance";
import { SettingsDefaults } from "./settings-defaults";
import { SettingsMcp } from "./settings-mcp";
import { SettingsMemory } from "./settings-memory";
import { SettingsRemoteAccess } from "./settings-remote-access";
import { SettingsWebsearch } from "./settings-websearch";

type SettingsBodyProps = {
  draft: ConfigDraft;
  /** 正在测试连通性的 provider key */
  testingKey: string | null;
  onTest: (provider: DraftProvider) => void;
};

/** 区块标题：用弱化的分组标签区分设置大类 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsBody({ draft, testingKey, onTest }: SettingsBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5 py-1">
      <Section title={t("外观")}>
        <SettingsAppearance />
      </Section>

      <Section title={t("模型")}>
        <div className="space-y-4">
          {draft.loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("加载中…")}
            </div>
          ) : null}

          {!draft.loading && draft.providers.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              {t("还没有接入供应商，从下面的目录里选一个，或添加自定义供应商。")}
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

          <ProviderCatalog
            catalog={draft.catalog}
            configuredIds={draft.configuredIds}
            onPick={draft.addFromCatalog}
          />

          <Button variant="outline" onClick={draft.addProvider}>
            <Plus className="size-4" />
            {t("添加自定义供应商")}
          </Button>
        </div>
      </Section>

      <Separator />

      <Section title={t("联网搜索")}>
        <SettingsWebsearch websearch={draft.websearch} onPatch={draft.patchWebsearch} />
      </Section>

      <Separator />

      <Section title={t("记忆")}>
        <SettingsMemory enabled={draft.memoryEnabled} onChange={draft.setMemoryEnabled} />
      </Section>

      <Separator />

      <Section title={t("远程访问")}>
        <SettingsRemoteAccess />
      </Section>

      <Separator />

      <Section title="MCP">
        <SettingsMcp />
      </Section>

      <Separator />

      <Section title={t("默认值")}>
        <SettingsDefaults
          options={draft.options}
          defaultModel={draft.defaultModel}
          thinkingLevel={draft.thinkingLevel}
          onSelectDefaultModel={draft.setDefaultModel}
          onSelectThinkingLevel={draft.setThinkingLevel}
        />
      </Section>
    </div>
  );
}
