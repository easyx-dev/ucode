/** 供应商列表：按内置 / 自定义分组，选中态高亮，状态点提示该条能否保存生效 */
import { cn } from "cn";
import { Boxes, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type DraftProvider,
  type DraftProviderSource,
  isDraftProviderReady,
} from "../config-draft";

type ProviderListProps = {
  providers: DraftProvider[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};

/** 分组顺序固定：内置在前，自定义在后 */
const SOURCES: readonly DraftProviderSource[] = ["builtin", "custom"];

function ProviderListItem({
  provider,
  selected,
  onSelect,
}: {
  provider: DraftProvider;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const ready = isDraftProviderReady(provider);
  const Icon = provider.source === "builtin" ? Boxes : Server;

  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-left text-sm whitespace-nowrap transition-colors md:w-full md:whitespace-normal",
        selected ? "bg-state-selected font-medium" : "hover:bg-state-hover",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-icon-sm text-foreground-subtle" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{provider.name || provider.id}</span>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-success" : "bg-warning")}
        aria-hidden
      />
      <span className="sr-only">{ready ? t("已就绪") : t("待配置")}</span>
    </button>
  );
}

export function ProviderList({ providers, selectedKey, onSelect }: ProviderListProps) {
  const { t } = useTranslation();
  const sourceLabels: Record<DraftProviderSource, string> = {
    builtin: t("内置"),
    custom: t("自定义"),
  };

  // 一条都没有时不渲染外壳：否则窄屏会多一条空白带、桌面端会多一条空竖栏
  if (providers.length === 0) return null;

  return (
    <div className="flex w-full min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:block md:w-60 md:space-y-4 md:overflow-y-auto md:border-r md:border-b-0 md:py-4">
      {SOURCES.map((source) => {
        const items = providers.filter((provider) => provider.source === source);
        if (items.length === 0) return null;
        return (
          <div key={source} className="flex shrink-0 gap-1 md:block md:w-full md:space-y-1">
            <h3 className="hidden px-2 pb-1 text-xs font-medium text-foreground-subtle md:block">
              {sourceLabels[source]}
            </h3>
            {items.map((provider) => (
              <ProviderListItem
                key={provider.key}
                provider={provider}
                selected={provider.key === selectedKey}
                onSelect={() => onSelect(provider.key)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
