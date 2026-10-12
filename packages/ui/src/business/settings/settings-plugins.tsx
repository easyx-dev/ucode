/**
 * 插件设置：本地目录安装、启停 / 卸载 / 重拉、诊断展示，以及市场来源的登记与刷新。
 *
 * 执行类组件（hooks / 扩展 / bin）按来源门控：第三方市场来的只出诊断、不注入运行时，
 * 所以界面上要**直接说明**哪些组件没有生效（见 `plans/plugins.md` 第五章）。
 */
import type { MarketplacePluginsResponse, PluginCreateRequest } from "@ucode/contracts";
import { FolderInput, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "../../base/badge";
import { Button } from "../../base/button";
import { Input } from "../../base/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../base/select";
import { Spinner } from "../../base/spinner";
import { usePlugins } from "../../hooks/use-plugins";
import { openDirectoryPickerDialog } from "../directory-picker-dialog";
import { SettingsGroup, SettingsRow } from "./settings-row";

/** 安装来源：与安装入参的来源类型一一对应 */
type SourceKind = "directory" | "url" | "npm" | "github" | "git";

export function SettingsPlugins() {
  const { t } = useTranslation();
  // 配置草稿按插件 id 分：同一屏可能同时改多个插件的配置
  const [drafts, setDrafts] = useState<Record<string, Record<string, string | number | boolean>>>(
    {},
  );
  const [purge, setPurge] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const {
    plugins,
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
  } = usePlugins();
  const [openCatalog, setOpenCatalog] = useState<string | null>(null);
  const [catalogEntries, setCatalogEntries] = useState<MarketplacePluginsResponse["plugins"]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind>("directory");
  const [sourceValue, setSourceValue] = useState("");
  const [ref, setRef] = useState("");
  const [marketName, setMarketName] = useState("");
  const [marketPath, setMarketPath] = useState("");

  const sourcePlaceholder =
    sourceKind === "directory"
      ? t("插件目录的绝对路径")
      : sourceKind === "url"
        ? t("压缩包直链（.zip / .tgz）")
        : sourceKind === "npm"
          ? t("包名，可带版本：@scope/name@1.2.3")
          : sourceKind === "github"
            ? t("owner/repo")
            : t("Git 仓库地址");

  const installFromSource = async () => {
    const value = sourceValue.trim();
    if (!value) return;
    // 网络来源可能要拉几十秒：按钮先进入进行中状态，避免看不到反应重复点
    setInstalling(true);
    const source: PluginCreateRequest["source"] =
      sourceKind === "directory"
        ? { source: "directory", path: value }
        : sourceKind === "url"
          ? { source: "url", url: value }
          : sourceKind === "npm"
            ? { source: "npm", package: value }
            : sourceKind === "github"
              ? { source: "github", repo: value, ...(ref.trim() ? { ref: ref.trim() } : {}) }
              : { source: "git", url: value, ...(ref.trim() ? { ref: ref.trim() } : {}) };
    try {
      if (await install({ source })) {
        setSourceValue("");
        setRef("");
      }
    } finally {
      setInstalling(false);
    }
  };

  /** `directory` 类型的配置项走系统目录选择器；`file` 类型仍是文本框（浏览器拿不到可靠的文件路径） */
  const pickDirectory = async (apply: (path: string) => void): Promise<void> => {
    const picked = await openDirectoryPickerDialog();
    if (picked) apply(picked);
  };

  const toggleCatalog = async (name: string) => {
    if (openCatalog === name) {
      setOpenCatalog(null);
      return;
    }
    setOpenCatalog(name);
    const data = await catalog(name);
    setCatalogEntries(data?.plugins ?? []);
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
              "插件把技能、命令、角色、钩子与 MCP 服务器打包在一起。本地目录来源不复制内容（改完重拉即可生效），网络来源会复制进插件缓存；来自第三方市场的钩子、扩展与命令目录不会注入运行时。",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sourceKind} onValueChange={(value) => setSourceKind(value as SourceKind)}>
            <SelectTrigger className="w-32" aria-label={t("安装来源")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="directory">{t("本地目录")}</SelectItem>
              <SelectItem value="url">{t("压缩包链接")}</SelectItem>
              <SelectItem value="npm">{t("npm 包")}</SelectItem>
              <SelectItem value="github">{t("GitHub 仓库")}</SelectItem>
              <SelectItem value="git">{t("Git 仓库")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="min-w-64 flex-1"
            value={sourceValue}
            onChange={(event) => setSourceValue(event.target.value)}
            placeholder={sourcePlaceholder}
            aria-label={t("安装来源")}
          />
          {sourceKind === "github" || sourceKind === "git" ? (
            <Input
              className="w-32"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder={t("分支 / 标签")}
              aria-label={t("分支 / 标签")}
            />
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void installFromSource()}
            disabled={!sourceValue.trim() || installing}
          >
            {installing ? (
              <Spinner className="size-icon-base" />
            ) : (
              <FolderInput className="size-icon-base" />
            )}
            {installing ? t("安装中…") : t("安装")}
          </Button>
        </div>
      </div>

      {plugins && plugins.plugins.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-foreground-subtle">
          {t("还没有安装插件。")}
        </p>
      ) : null}

      {plugins?.plugins.map((plugin) => {
        const draft = drafts[plugin.id] ?? {};
        const setDraft = (
          update: (
            prev: Record<string, string | number | boolean>,
          ) => Record<string, string | number | boolean>,
        ): void => setDrafts((prev) => ({ ...prev, [plugin.id]: update(prev[plugin.id] ?? {}) }));
        const saveConfig = async (): Promise<void> => {
          const values = drafts[plugin.id] ?? {};
          if (Object.keys(values).length === 0) return;
          if (await setConfig(plugin.id, values)) {
            setDrafts((prev) => ({ ...prev, [plugin.id]: {} }));
          }
        };
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
                <label className="flex items-center gap-1 text-xs text-foreground-subtle">
                  <input
                    type="checkbox"
                    checked={purge === plugin.id}
                    aria-label={t("卸载并清理缓存")}
                    onChange={(event) => setPurge(event.target.checked ? plugin.id : null)}
                  />
                  {t("清理缓存")}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void uninstall(plugin.id, purge === plugin.id)}
                >
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

            {plugin.componentRefs.length > 0 ? (
              <details className="rounded-lg border border-dashed px-3 py-2">
                <summary className="cursor-pointer text-xs text-foreground-subtle">
                  {t("组件（{{count}}）", { count: plugin.componentRefs.length })}
                </summary>
                <div className="mt-2 space-y-1">
                  {plugin.componentRefs.map((entry) => (
                    <p
                      key={`${entry.group}-${entry.name}`}
                      className="font-mono text-xs break-all text-foreground-subtle"
                    >
                      {entry.group}: {entry.name}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}

            {plugin.userConfig.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-dashed px-3 py-2">
                {plugin.userConfig.map((field) => (
                  <div key={field.key} className="block space-y-1">
                    <span className="text-xs font-medium">
                      {field.title}
                      {field.required ? <span className="text-destructive"> *</span> : null}
                    </span>
                    {field.description ? (
                      <span className="block text-xs text-foreground-subtle">
                        {field.description}
                      </span>
                    ) : null}
                    {field.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={draft[field.key] === true}
                        aria-label={field.title}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, [field.key]: event.target.checked }))
                        }
                      />
                    ) : field.type === "select" && field.options ? (
                      <Select
                        value={String(draft[field.key] ?? field.options?.[0] ?? "")}
                        onValueChange={(value) =>
                          setDraft((prev) => ({ ...prev, [field.key]: value }))
                        }
                      >
                        <SelectTrigger aria-label={field.title}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={String(draft[field.key] ?? "")}
                        type={field.type === "number" ? "number" : "text"}
                        aria-label={field.title}
                        placeholder={field.sensitive ? t("已设置（留空表示不改）") : t("未设置")}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            [field.key]:
                              field.type === "number" && event.target.value !== ""
                                ? Number(event.target.value)
                                : event.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void saveConfig()}
                  disabled={Object.keys(draft).length === 0}
                >
                  {t("保存配置")}
                </Button>
              </div>
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
            "市场是一份插件清单（marketplace.json），可来自本地目录、url 直链或 git 仓库；刷新后点「查看插件」看目录内容。内置的 Claude 官方市场是 git 源。",
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
            <Button variant="ghost" size="sm" onClick={() => void toggleCatalog(market.name)}>
              {openCatalog === market.name ? t("收起") : t("查看插件")}
            </Button>
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

      {openCatalog ? (
        <div className="space-y-1 rounded-xl border border-dashed px-4 py-3">
          {catalogEntries.length === 0 ? (
            <p className="text-xs text-foreground-subtle">
              {t("该市场还没有插件（或尚未刷新）。")}
            </p>
          ) : (
            catalogEntries.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center justify-between gap-4 text-xs text-foreground-subtle"
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono">{entry.name}</span>
                  {entry.description ? ` · ${entry.description}` : ""}
                </span>
                <span className="shrink-0">
                  v{entry.version}
                  {entry.installedId === null
                    ? ""
                    : entry.updateAvailable
                      ? ` · ${t("已安装，可更新")}`
                      : ` · ${t("已安装")}`}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}

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
