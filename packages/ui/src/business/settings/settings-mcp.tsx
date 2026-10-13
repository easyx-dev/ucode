/** MCP 设置：用户级 MCP 服务器的增删改；改动即时写入 mcp.json，新会话生效 */
import type { McpServerView } from "@ucode/contracts";
import { Pencil, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { useMcpServers } from "../../hooks/use-mcp-servers";
import { McpServerFormDialog } from "./mcp-server-form-dialog";
import { SettingsEmptyState, SettingsSectionHeader } from "./settings-page";
import { SettingsGroup } from "./settings-row";

/** 列表里的一行摘要：stdio 展示命令，http 展示地址 */
const targetSummary = (server: McpServerView): string =>
  server.type === "stdio" ? [server.command, ...(server.args ?? [])].join(" ") : server.url;

export function SettingsMcp() {
  const { t } = useTranslation();
  const { data, upsert, remove } = useMcpServers();
  const [editing, setEditing] = useState<McpServerView | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (server: McpServerView) => {
    setEditing(server);
    setFormOpen(true);
  };

  const addButton = (
    <Button variant="outline" size="sm" onClick={openAdd}>
      <Plus className="size-icon-base" />
      {t("添加服务器")}
    </Button>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <SettingsSectionHeader
          title={t("服务器")}
          meta={data ? t("{{count}} 个", { count: data.servers.length }) : null}
          action={addButton}
        />

        {data === null ? null : data.servers.length === 0 ? (
          <SettingsEmptyState
            icon={Plug}
            title={t("还没有配置 MCP 服务器")}
            description={t("添加服务器后，它提供的工具会出现在新会话里。")}
            action={
              <Button size="sm" onClick={openAdd}>
                <Plus className="size-icon-base" />
                {t("添加服务器")}
              </Button>
            }
          />
        ) : (
          <SettingsGroup>
            {data.servers.map((server) => (
              <div key={server.name} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{server.name}</span>
                    {server.enabled ? null : (
                      <span className="shrink-0 text-xs text-foreground-subtle">{t("已停用")}</span>
                    )}
                  </div>
                  <p className="truncate font-mono text-xs text-foreground-subtle">
                    {targetSummary(server)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("编辑")}
                  onClick={() => openEdit(server)}
                >
                  <Pencil className="size-icon-base" />
                </Button>
              </div>
            ))}
          </SettingsGroup>
        )}
      </div>

      {data && data.errors.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-destructive/40 px-4 py-3">
          <p className="text-sm font-medium text-destructive">{t("配置文件有无法解析的条目：")}</p>
          {data.errors.map((error) => (
            <p key={error} className="font-mono text-xs break-all text-foreground-subtle">
              {error}
            </p>
          ))}
        </div>
      ) : null}

      <p className="text-xs break-all text-foreground-subtle">
        {t("配置文件：{{path}}", { path: data?.configPath ?? "" })}
      </p>

      {formOpen ? (
        <McpServerFormDialog
          initial={editing}
          onOpenChange={(open) => {
            if (!open) setFormOpen(false);
          }}
          onSubmit={upsert}
          onDelete={remove}
        />
      ) : null}
    </div>
  );
}
