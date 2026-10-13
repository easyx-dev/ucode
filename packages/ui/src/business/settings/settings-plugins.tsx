/**
 * 插件设置：已安装插件与随包内置插件两段列表，下面是自定义市场的登记。
 *
 * 安装与市场相关的交互各自成组件（PluginInstallDialog / PluginMarketSection），
 * 这一层只管数据与分段。
 */
import { Package, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { usePlugins } from "../../hooks/use-plugins";
import { useWorkbench } from "../../provider/workbench";
import { PluginInstallDialog } from "./plugin-install-dialog";
import { PluginListItem } from "./plugin-list-item";
import { PluginMarketSection } from "./plugin-market-section";
import { SettingsEmptyState, SettingsSectionHeader } from "./settings-page";
import { SettingsGroup } from "./settings-row";

export function SettingsPlugins() {
  const { t } = useTranslation();
  const [installOpen, setInstallOpen] = useState(false);
  // 生效开关按当前会话的工作目录算：切会话即换一套项目覆盖
  const cwd = useWorkbench()?.cwd ?? null;
  const {
    plugins,
    progress,
    marketplaces,
    install,
    setEnabled,
    setConfig,
    uninstall,
    refresh,
    addMarketplace,
    removeMarketplace,
    refreshMarketplace,
    catalog,
  } = usePlugins(cwd);

  const all = plugins?.plugins ?? [];
  // 随包内置与用户自己装的分开列：前者随版本升级变，后者是用户的选择
  const builtin = all.filter((plugin) => plugin.source === "official");
  const installed = all.filter((plugin) => plugin.source !== "official");

  const renderRow = (plugin: (typeof all)[number]) => (
    <PluginListItem
      key={plugin.id}
      plugin={plugin}
      onSetEnabled={setEnabled}
      onSetConfig={setConfig}
      onUninstall={uninstall}
      onRefresh={refresh}
    />
  );

  const installButton = (
    <Button size="sm" onClick={() => setInstallOpen(true)}>
      <Plus className="size-icon-base" />
      {t("安装插件")}
    </Button>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SettingsSectionHeader
          title={t("已安装")}
          meta={t("{{count}} 个", { count: installed.length })}
          action={installButton}
        />

        {installed.length === 0 ? (
          <SettingsEmptyState
            icon={Package}
            title={t("尚未安装插件")}
            description={t(
              "插件把技能、命令、角色、钩子与 MCP 服务器打包在一起；可从本地目录、压缩包、npm 或 git 仓库安装。",
            )}
            action={installButton}
          />
        ) : (
          <SettingsGroup>{installed.map(renderRow)}</SettingsGroup>
        )}
      </section>

      {builtin.length > 0 ? (
        <section className="space-y-3">
          <SettingsSectionHeader
            title={t("内置")}
            meta={t("{{count}} 个", { count: builtin.length })}
          />
          <SettingsGroup>{builtin.map(renderRow)}</SettingsGroup>
        </section>
      ) : null}

      <PluginMarketSection
        marketplaces={marketplaces}
        onAdd={addMarketplace}
        onRemove={removeMarketplace}
        onRefresh={refreshMarketplace}
        onLoadCatalog={catalog}
        onInstall={install}
        onRefreshPlugin={refresh}
      />

      <p className="text-xs break-all text-foreground-subtle">
        {t("状态文件：{{path}}", { path: plugins?.statePath ?? "" })}
      </p>
      {plugins?.overrides ? (
        <div className="space-y-1 text-xs break-all text-foreground-subtle">
          <p>
            {t("本仓库的覆盖文件：{{project}}（个人覆盖：{{local}}）", {
              project: plugins.overrides.projectPath,
              local: plugins.overrides.localPath,
            })}
          </p>
          {plugins.overrides.diagnostics.map((message) => (
            <p key={message} className="text-destructive">
              {message}
            </p>
          ))}
        </div>
      ) : null}

      <PluginInstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstall={install}
        progress={progress}
      />
    </div>
  );
}
