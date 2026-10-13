/** 模型设置：一张卡里左右两栏——左边供应商列表，右边当前供应商的详情 */

import { cn } from "cn";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Spinner } from "../../base/spinner";
import type { ConfigDraft } from "../../hooks/use-config-draft";
import type { DraftProvider } from "../../lib/config-draft";
import { ProviderAddDialog } from "./provider-add-dialog";
import { ProviderDetail } from "./provider-detail";
import { ProviderList } from "./provider-list";
import { SETTINGS_CONTENT_COLUMN, SettingsPageHeader } from "./settings-page";

type SettingsModelsProps = {
  /** 页头标题：与导航项共用同一份元数据 */
  title: string;
  /** 页头说明：配置何时生效与 apiKey 的语义 */
  description: string;
  /** 页头右侧的保存区 */
  trailing: ReactNode;
  draft: ConfigDraft;
  /** 正在测试连通性的 provider key */
  testingKey: string | null;
  onTest: (provider: DraftProvider) => void;
};

/** 一条供应商都没有时的占位：加载中或空态 */
function DraftPlaceholder({ loading }: { loading: boolean }) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-foreground-subtle">
        <Spinner className="size-icon-base" />
        {t("加载中…")}
      </p>
    );
  }
  return (
    <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-foreground-subtle">
      {t("还没有接入供应商，点右上角「添加供应商」。")}
    </p>
  );
}

/** 右栏：当前选中的供应商详情；没有供应商时给占位 */
function ProviderPane({
  provider,
  draft,
  testingKey,
  onTest,
}: Pick<SettingsModelsProps, "draft" | "testingKey" | "onTest"> & {
  provider: DraftProvider | null;
}) {
  if (!provider) return <DraftPlaceholder loading={draft.loading} />;

  return (
    <ProviderDetail
      // 按 provider 重新挂载：拉取结果、错误态等局部状态不跟着选中项串门
      key={provider.key}
      provider={provider}
      testing={testingKey === provider.key}
      onPatch={(patch) => draft.patchProvider(provider.key, patch)}
      onModelPatch={(modelKey, patch) => draft.patchModel(provider.key, modelKey, patch)}
      onAddModel={(fields) => draft.addModel(provider.key, fields)}
      onRemoveModel={(modelKey) => draft.removeModel(provider.key, modelKey)}
      onRemove={() => draft.removeProvider(provider.key)}
      onTest={() => onTest(provider)}
    />
  );
}

function AddProviderButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Plus className="size-icon-base" />
      {t("添加供应商")}
    </Button>
  );
}

export function SettingsModels({
  title,
  description,
  trailing,
  draft,
  testingKey,
  onTest,
}: SettingsModelsProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // 选中的条目被删除时回落到第一条，无需 effect 纠正
  const selected =
    draft.providers.find((provider) => provider.key === selectedKey) ?? draft.providers[0] ?? null;

  const addFromCatalog = (providerId: string): void => {
    setSelectedKey(draft.addFromCatalog(providerId));
    setAdding(false);
  };

  const addCustom = (): void => {
    setSelectedKey(draft.addProvider());
    setAdding(false);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPageHeader
        title={title}
        description={description}
        action={<AddProviderButton onClick={() => setAdding(true)} />}
        trailing={trailing}
      />

      {/* 顶部留白给两栏卡的 ring 留余量：贴住上边界时描边会被裁掉 */}
      <div className="min-h-0 min-w-0 flex-1 px-6 pt-4 pb-6 md:px-8">
        <div
          className={cn(
            SETTINGS_CONTENT_COLUMN,
            "flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-popover ring-1 ring-border-strong md:flex-row",
          )}
        >
          <ProviderList
            providers={draft.providers}
            selectedKey={selected?.key ?? null}
            onSelect={setSelectedKey}
          />

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
            <ProviderPane
              provider={selected}
              draft={draft}
              testingKey={testingKey}
              onTest={onTest}
            />
          </div>
        </div>
      </div>

      <ProviderAddDialog
        open={adding}
        onOpenChange={setAdding}
        catalog={draft.catalog}
        configuredIds={draft.configuredIds}
        onSelect={addFromCatalog}
        onAddCustom={addCustom}
      />
    </div>
  );
}
