/** MCP 设置：用户级 MCP 服务器的增删改；改动即时写入 mcp.json，新会话生效 */
import type { McpServerView } from "@ucode/contracts";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMcpServers } from "../../hooks/use-mcp-servers";
import { Button } from "../ui/button";
import { McpServerFormDialog } from "./mcp-server-form-dialog";

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

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "接入 MCP（Model Context Protocol）服务器，为 agent 增加外部工具；改动写入本机配置文件，新会话生效。",
          )}
        </p>
        <Button variant="outline" size="sm" onClick={openAdd}>
          <Plus className="size-4" />
          {t("添加服务器")}
        </Button>
      </div>

      {data && data.servers.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t("还没有配置 MCP 服务器。")}
        </p>
      ) : null}

      {data?.servers.map((server) => (
        <div
          key={server.name}
          className="flex items-center justify-between gap-4 rounded-xl bg-popover px-4 py-3 ring-1 ring-foreground/10"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{server.name}</span>
              {server.enabled ? null : (
                <span className="shrink-0 text-xs text-muted-foreground">{t("已停用")}</span>
              )}
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {targetSummary(server)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("编辑")}
            onClick={() => openEdit(server)}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      ))}

      {data && data.errors.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-destructive/40 px-3 py-2">
          <p className="text-xs font-medium text-destructive">{t("配置文件有无法解析的条目：")}</p>
          {data.errors.map((error) => (
            <p key={error} className="font-mono text-xs break-all text-muted-foreground">
              {error}
            </p>
          ))}
        </div>
      ) : null}

      <p className="text-[11px] break-all text-muted-foreground">
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
