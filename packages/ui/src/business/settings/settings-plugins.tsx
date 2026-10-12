/**
 * 插件设置：本地目录安装、启停 / 卸载 / 重拉、诊断展示，以及市场来源的登记与刷新。
 *
 * 执行类组件（hooks / 扩展 / bin）按来源门控：第三方市场来的只出诊断、不注入运行时，
 * 所以界面上要**直接说明**哪些组件没有生效（见 `plans/plugins.md` 第五章）。
 */
import type { PluginView } from "@ucode/contracts";
import { FolderInput, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "../../base/badge";
import { Button } from "../../base/button";
import { Input } from "../../base/input";
import { usePlugins } from "../../hooks/use-plugins";
import { SettingsGroup, SettingsRow } from "./settings-row";

export function SettingsPlugins() {
  const { t } = useTranslation();
  const {
    plugins,
    marketplaces,
    install,
    setEnabled,
    uninstall,
    refresh,
    addMarketplace,
    removeMarketplace,
    refreshMarketplace,
  } = usePlugins();
  const [path, setPath] = useState("");
  const [marketName, setMarketName] = useState("");
  const [marketPath, setMarketPath] = useState("");

  const installFromPath = async () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    if (await install({ source: { source: "directory", path: trimmed } })) setPath("");
  };

  const addLocalMarket = async () => {
    const name = marketName.trim();
    const dir = marketPath.trim();
    if (!name || !dir) return;
    if (await addMarketplace({ name, source: { source: "directory", path: dir } })) {
      setMarketName("");
      setMarketPath("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs leading-relaxed text-foreground-subtle">
            {t(
              "插件把技能、命令、角色、钩子与 MCP 服务器打包在一起。本轮安装只支持本地目录（不复制内容，改完重拉即可生效）；来自第三方市场的钩子、扩展与命令目录不会注入运行时。",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={t("插件目录的绝对路径")}
            aria-label={t("插件目录")}
          />
          <Button variant="outline" size="sm" onClick={installFromPath} disabled={!path.trim()}>
            <FolderInput className="size-icon-base" />
            {t("从目录安装")}
          </Button>
        </div>
      </div>

      {plugins && plugins.plugins.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-foreground-subtle">
          {t("还没有安装插件。")}
        </p>
      ) : null}

      {plugins?.plugins.map((plugin) => {
        const sourceLabel =
          plugin.source === "official"
            ? t("随包官方")
            : plugin.source === "local"
              ? t("本地登记")
              : t("第三方市场");
        const counts = plugin.components;
        const parts = [
          counts.skills > 0 ? `${t("技能")} ${counts.skills}` : null,
          counts.commands > 0 ? `${t("命令")} ${counts.commands}` : null,
          counts.agents > 0 ? `${t("角色")} ${counts.agents}` : null,
          counts.hooks > 0 ? `${t("钩子")} ${counts.hooks}` : null,
          counts.mcp > 0 ? `MCP ${counts.mcp}` : null,
          counts.bin > 0 ? `${t("命令目录")} ${counts.bin}` : null,
          counts.extensions > 0 ? `${t("扩展")} ${counts.extensions}` : null,
        ].filter((item): item is string => item !== null);

        return (
          <div
            key={plugin.id}
            className="space-y-2 rounded-xl bg-popover p-4 ring-1 ring-border-strong"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{plugin.displayName}</span>
                  <Badge variant="outline">{sourceLabel}</Badge>
                  <span className="shrink-0 text-xs text-foreground-subtle">v{plugin.version}</span>
                  {plugin.enabled ? null : (
                    <span className="shrink-0 text-xs text-foreground-subtle">{t("已停用")}</span>
                  )}
                </div>
                <p className="truncate font-mono text-xs text-foreground-subtle">{plugin.id}</p>
                {plugin.description ? (
                  <p className="text-xs leading-relaxed text-foreground-subtle">
                    {plugin.description}
                  </p>
                ) : null}
                <p className="text-xs text-foreground-subtle">
                  {parts.length > 0 ? parts.join(" · ") : t("没有组件")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void setEnabled(plugin.id, !plugin.enabled)}
                >
                  {plugin.enabled ? t("停用") : t("启用")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void refresh(plugin.id)}>
                  <RefreshCw className="size-icon-base" />
                  {t("重拉")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void uninstall(plugin.id)}>
                  <Trash2 className="size-icon-base" />
                  {t("卸载")}
                </Button>
              </div>
            </div>

            {plugin.blockedComponents.length > 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-2 text-xs leading-relaxed text-foreground-subtle">
                {t(
                  "来自第三方市场的 {{components}} 不会注入运行时（插件跑起来就是你的权限，故只对随包与本地登记的插件开放）。",
                  {
                    components: plugin.blockedComponents.join(" / "),
                  },
                )}
              </p>
            ) : null}

            {plugin.diagnostics.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-dashed px-3 py-2">
                {plugin.diagnostics.map((item) => (
                  <p
                    key={`${item.level}-${item.component}-${item.message}`}
                    className="font-mono text-xs break-all text-foreground-subtle"
                  >
                    [{item.level}] {item.component}: {item.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <SettingsGroup>
        <SettingsRow
          title={t("插件市场")}
          description={t(
            "市场是一份插件清单（marketplace.json）。本轮只支持本地目录市场；内置的 Claude 官方市场是 git 源，等网络底座落地后才可刷新。",
          )}
          control={
            <span className="text-xs text-foreground-subtle">
              {marketplaces
                ? t("{{count}} 个来源", { count: marketplaces.marketplaces.length })
                : ""}
            </span>
          }
        />
      </SettingsGroup>

      {marketplaces?.marketplaces.map((market) => (
        <div
          key={market.name}
          className="flex items-center justify-between gap-4 rounded-xl bg-popover px-4 py-3 ring-1 ring-border-strong"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{market.name}</span>
              {market.builtin ? <Badge variant="outline">{t("内置")}</Badge> : null}
            </div>
            <p className="truncate font-mono text-xs text-foreground-subtle">{market.source}</p>
            <p className="text-xs text-foreground-subtle">
              {market.refreshedOk
                ? t("{{count}} 个插件", { count: market.pluginCount })
                : (market.lastError ?? t("尚未刷新"))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void refreshMarketplace(market.name)}>
              <RefreshCw className="size-icon-base" />
              {t("刷新")}
            </Button>
            {market.builtin ? null : (
              <Button variant="ghost" size="sm" onClick={() => void removeMarketplace(market.name)}>
                <Trash2 className="size-icon-base" />
                {t("移除")}
              </Button>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Input
          value={marketName}
          onChange={(event) => setMarketName(event.target.value)}
          placeholder={t("市场名（小写字母、数字与 - . _）")}
          aria-label={t("市场名")}
        />
        <Input
          value={marketPath}
          onChange={(event) => setMarketPath(event.target.value)}
          placeholder={t("含 marketplace.json 的目录")}
          aria-label={t("市场目录")}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={addLocalMarket}
          disabled={!marketName.trim() || !marketPath.trim()}
        >
          {t("登记市场")}
        </Button>
      </div>

      <p className="text-xs break-all text-foreground-subtle">
        {t("状态文件：{{path}}", { path: plugins?.statePath ?? "" })}
      </p>
    </div>
  );
}
