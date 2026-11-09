/**
 * 插件列表的一行：名称、来源与组件摘要在第一行，右侧是启用开关与更多动作；
 * 配置表单、组件清单与诊断信息收在下方（它们只在配置与排查时才看）。
 *
 * 执行类组件按来源门控：第三方市场来的不注入运行时，所以这里要直说哪些组件没有生效。
 */
import type { PluginView } from "@ucode/contracts";
import type { TFunction } from "i18next";
import { MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../base/badge";
import { Button } from "../../../base/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../base/dropdown-menu";
import { Input } from "../../../base/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../base/select";
import { Switch } from "../../../base/switch";
import { openDirectoryPickerDialog } from "../../dialog/directory-picker-dialog";

type PluginListItemProps = {
  plugin: PluginView;
  onSetEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  onSetConfig: (id: string, config: Record<string, string | number | boolean>) => Promise<boolean>;
  onUninstall: (id: string, purge?: boolean) => Promise<boolean>;
  onRefresh: (id: string) => Promise<boolean>;
};

/** 来源 → 界面标签：官方市场、本地登记、第三方市场各一档 */
const sourceLabel = (source: PluginView["source"], t: TFunction): string => {
  if (source === "official") return t("官方市场");
  if (source === "local") return t("本地登记");
  return t("第三方市场");
};

/** 组件计数摘要：只报有的那几类 */
const componentSummary = (plugin: PluginView, t: TFunction): string[] => {
  const counts = plugin.components;
  return [
    counts.skills > 0 ? `${t("技能")} ${counts.skills}` : null,
    counts.commands > 0 ? `${t("命令")} ${counts.commands}` : null,
    counts.agents > 0 ? `${t("角色")} ${counts.agents}` : null,
    counts.hooks > 0 ? `${t("钩子")} ${counts.hooks}` : null,
    counts.mcp > 0 ? `MCP ${counts.mcp}` : null,
    counts.bin > 0 ? `${t("命令目录")} ${counts.bin}` : null,
    counts.extensions > 0 ? `${t("扩展")} ${counts.extensions}` : null,
    counts.ui > 0 ? `${t("界面")} ${counts.ui}` : null,
    counts.server > 0 ? `${t("服务端")} ${counts.server}` : null,
  ].filter((part): part is string => part !== null);
};

export function PluginListItem({
  plugin,
  onSetEnabled,
  onSetConfig,
  onUninstall,
  onRefresh,
}: PluginListItemProps) {
  const { t } = useTranslation();
  // 配置草稿按这一条插件自己持有：一行一个实例，天然隔离
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const [configOpen, setConfigOpen] = useState(false);

  const parts = componentSummary(plugin, t);
  const configurable = plugin.userConfig.length > 0;
  // 生效值来自仓库里的覆盖文件时，改登记表不会有效果：开关置灰，改文件才生效
  const switchable = plugin.enabledBy === "user";

  const saveConfig = async (): Promise<void> => {
    if (Object.keys(draft).length === 0) return;
    if (await onSetConfig(plugin.id, draft)) setDraft({});
  };

  /** `directory` / `file` 类型的配置项走系统选择器（同一弹层，选文件时点文件即确认） */
  const pickPath = async (
    select: "directory" | "file",
    apply: (path: string) => void,
  ): Promise<void> => {
    const picked = await openDirectoryPickerDialog({ select });
    if (picked) apply(picked);
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{plugin.displayName}</span>
            <Badge variant="outline">{sourceLabel(plugin.source, t)}</Badge>
            <span className="shrink-0 text-xs text-foreground-subtle">v{plugin.version}</span>
            <span className="shrink-0 text-xs text-foreground-subtle">
              {parts.length > 0 ? parts.join(" · ") : t("没有组件")}
            </span>
          </div>
          {plugin.description ? (
            <p className="truncate text-sm text-foreground-subtle" title={plugin.description}>
              {plugin.description}
            </p>
          ) : null}
          <p className="truncate font-mono text-xs text-foreground-subtle">{plugin.id}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {configurable ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={configOpen}
              onClick={() => setConfigOpen((prev) => !prev)}
            >
              {t("配置")}
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("更多操作")}>
                <MoreHorizontal className="size-icon-base" />
              </Button>
            </DropdownMenuTrigger>
            {/* 宽度默认跟随触发器（适合选择器），这里要做动作菜单：放宽到能放下最长的一项 */}
            <DropdownMenuContent align="end" className="w-auto min-w-40">
              <DropdownMenuItem onSelect={() => void onRefresh(plugin.id)}>
                <RefreshCw className="size-icon-sm" />
                {t("重拉")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onUninstall(plugin.id, false)}>
                <Trash2 className="size-icon-sm" />
                {t("卸载")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onUninstall(plugin.id, true)}>
                <Trash2 className="size-icon-sm" />
                {t("卸载并清理缓存")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Switch
            checked={plugin.enabled}
            disabled={!switchable}
            aria-label={t("启用插件")}
            onCheckedChange={(enabled) => void onSetEnabled(plugin.id, enabled)}
          />
        </div>
      </div>

      {switchable ? null : (
        <p className="text-xs text-foreground-subtle">
          {t("开关由本仓库的覆盖文件决定，改文件才生效。")}
        </p>
      )}

      {plugin.blockedComponents.length > 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs leading-relaxed text-foreground-subtle">
          {t(
            "来自第三方市场的 {{components}} 不会注入运行时（插件跑起来就是你的权限，故只对官方市场与本地登记的插件开放）。",
            { components: plugin.blockedComponents.join(" / ") },
          )}
        </p>
      ) : null}

      {configOpen ? (
        <div className="space-y-3 rounded-lg border border-dashed px-3 py-3">
          {plugin.userConfig.map((field) => (
            <div key={field.key} className="space-y-1">
              <span className="block text-sm font-medium">
                {field.title}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </span>
              {field.description ? (
                <span className="block text-xs text-foreground-subtle">{field.description}</span>
              ) : null}
              {field.type === "boolean" ? (
                <Switch
                  checked={draft[field.key] === true}
                  aria-label={field.title}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, [field.key]: checked }))
                  }
                />
              ) : field.type === "select" && field.options ? (
                <Select
                  value={String(draft[field.key] ?? field.options?.[0] ?? "")}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))}
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
                <div className="flex items-center gap-2">
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
                  {field.type === "directory" || field.type === "file" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void pickPath(field.type === "file" ? "file" : "directory", (path) =>
                          setDraft((prev) => ({ ...prev, [field.key]: path })),
                        )
                      }
                    >
                      {field.type === "file" ? t("选择文件") : t("选择目录")}
                    </Button>
                  ) : null}
                </div>
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
}
