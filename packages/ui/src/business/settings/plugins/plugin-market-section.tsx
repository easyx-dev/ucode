/** 插件市场：来源登记、刷新，以及市场内插件的目录与安装入口 */
import type {
  MarketplaceCreateRequest,
  MarketplacePluginsResponse,
  MarketplacesListResponse,
  PluginCreateRequest,
} from "@ucode/contracts";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../base/badge";
import { Button } from "../../../base/button";
import { Input } from "../../../base/input";
import { SettingsSectionHeader } from "../settings-page";
import { SettingsGroup } from "../settings-row";

type PluginMarketSectionProps = {
  marketplaces: MarketplacesListResponse | null;
  onAdd: (input: MarketplaceCreateRequest) => Promise<boolean>;
  onRemove: (name: string) => Promise<boolean>;
  onRefresh: (name: string) => Promise<boolean>;
  /** 市场内插件清单：点开才取 */
  onLoadCatalog: (name: string) => Promise<MarketplacePluginsResponse | null>;
  /** 安装市场里的插件；已登记的条目改走 onRefreshPlugin */
  onInstall: (input: PluginCreateRequest) => Promise<boolean>;
  onRefreshPlugin: (id: string) => Promise<boolean>;
};

export function PluginMarketSection({
  marketplaces,
  onAdd,
  onRemove,
  onRefresh,
  onLoadCatalog,
  onInstall,
  onRefreshPlugin,
}: PluginMarketSectionProps) {
  const { t } = useTranslation();
  const [openCatalog, setOpenCatalog] = useState<string | null>(null);
  const [entries, setEntries] = useState<MarketplacePluginsResponse["plugins"]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  const toggleCatalog = async (market: string): Promise<void> => {
    if (openCatalog === market) {
      setOpenCatalog(null);
      return;
    }
    setOpenCatalog(market);
    setEntries((await onLoadCatalog(market))?.plugins ?? []);
  };

  const addLocalMarket = async (): Promise<void> => {
    const marketName = name.trim();
    const dir = path.trim();
    if (!marketName || !dir) return;
    if (await onAdd({ name: marketName, source: { source: "directory", path: dir } })) {
      setName("");
      setPath("");
    }
  };

  const installEntry = async (
    entry: MarketplacePluginsResponse["plugins"][number],
    market: string,
  ): Promise<void> => {
    // 已登记的走重拉：再发一次 create 会被服务端按「插件已登记」拒掉
    if (entry.installedId !== null) {
      void onRefreshPlugin(entry.installedId);
      return;
    }
    setInstalling(true);
    try {
      // 必须带上所属市场，否则服务端按本地登记（local 档），执行类组件的来源门控会被绕开
      await onInstall({
        source: entry.source as PluginCreateRequest["source"],
        marketplace: market,
      });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="space-y-3">
      <SettingsSectionHeader
        title={t("插件市场")}
        meta={
          marketplaces ? t("{{count}} 个来源", { count: marketplaces.marketplaces.length }) : null
        }
      />
      <p className="text-sm leading-relaxed text-foreground-subtle">
        {t(
          "市场是一份插件清单（marketplace.json），可来自本地目录、url 直链或 git 仓库；刷新后点「查看插件」看目录内容。内置的 Claude 官方市场是 git 源。",
        )}
      </p>

      {marketplaces === null ? null : marketplaces.marketplaces.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-foreground-subtle">
          {t("还没有登记市场。")}
        </p>
      ) : (
        <SettingsGroup>
          {marketplaces.marketplaces.map((market) => (
            <div key={market.name} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{market.name}</span>
                {market.builtin ? <Badge variant="outline">{t("内置")}</Badge> : null}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => void toggleCatalog(market.name)}>
                    {openCatalog === market.name ? t("收起") : t("查看插件")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    // 刷新期间禁用：连点会并发拉同一个市场（服务端已按市场串行，这里给出反馈）
                    disabled={refreshing === market.name}
                    onClick={() => {
                      setRefreshing(market.name);
                      void onRefresh(market.name).finally(() => setRefreshing(null));
                    }}
                  >
                    <RefreshCw className="size-icon-base" />
                    {refreshing === market.name ? t("刷新中…") : t("刷新")}
                  </Button>
                  {market.builtin ? null : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("移除市场")}
                      onClick={() => void onRemove(market.name)}
                    >
                      <Trash2 className="size-icon-base" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="truncate font-mono text-xs text-foreground-subtle">{market.source}</p>
              <p className="text-xs text-foreground-subtle">
                {market.refreshedOk
                  ? t("{{count}} 个插件", { count: market.pluginCount })
                  : (market.lastError ?? t("尚未刷新"))}
              </p>

              {openCatalog === market.name ? (
                <div className="space-y-1 rounded-lg border border-dashed px-3 py-2">
                  {entries.length === 0 ? (
                    <p className="text-xs text-foreground-subtle">
                      {t("该市场还没有插件（或尚未刷新）。")}
                    </p>
                  ) : (
                    entries.map((entry) => (
                      <div
                        key={entry.name}
                        className="flex items-center justify-between gap-4 text-xs text-foreground-subtle"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono">{entry.name}</span>
                          {entry.description ? ` · ${entry.description}` : ""}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span>
                            v{entry.version}
                            {entry.installedId === null
                              ? ""
                              : entry.updateAvailable
                                ? ` · ${t("已安装，可更新")}`
                                : ` · ${t("已安装")}`}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={entry.source === null || installing}
                            onClick={() => void installEntry(entry, market.name)}
                          >
                            {entry.installedId === null ? t("安装") : t("重装")}
                          </Button>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </SettingsGroup>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("市场名（小写字母、数字与 - . _）")}
          aria-label={t("市场名")}
        />
        <Input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder={t("含 marketplace.json 的目录")}
          aria-label={t("市场目录")}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void addLocalMarket()}
          disabled={!name.trim() || !path.trim()}
        >
          {t("登记市场")}
        </Button>
      </div>
    </section>
  );
}
