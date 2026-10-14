/**
 * 一类资产的分区页：可编辑段（本机 / 项目）、只读段（插件 / 内置）、解析失败的条目与新建入口。
 *
 * 三页共用，差别只有 `kind` 与文案；读详情才取正文，列表本身不含文件内容。
 */
import type { AssetDetail, AssetKind, AssetView } from "@ucode/contracts";
import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { useAssets } from "../../../hooks/store/use-assets";
import { useWorkbench } from "../../../provider/workbench";
import { confirm } from "../../dialog/queue";
import { SettingsSectionHeader } from "../settings-page";
import { SettingsGroup } from "../settings-row";
import { AssetFormDialog } from "./asset-form-dialog";
import { AssetListItem } from "./asset-list-item";

/** 列表响应里三类资产各自的字段名 */
const LIST_FIELD: Record<AssetKind, "agents" | "skills" | "commands"> = {
  agent: "agents",
  skill: "skills",
  command: "commands",
};

type AssetSectionProps = {
  kind: AssetKind;
  icon: LucideIcon;
  /** 新建按钮与弹窗标题用的文案 */
  createLabel: string;
  emptyTitle: string;
  emptyDescription: string;
};

export function AssetSection({
  kind,
  icon: Icon,
  createLabel,
  emptyTitle,
  emptyDescription,
}: AssetSectionProps) {
  const { t } = useTranslation();
  const cwd = useWorkbench()?.cwd ?? null;
  const { data, read, save, remove } = useAssets(cwd ? { cwd } : {});
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const items = data ? data[LIST_FIELD[kind]] : [];
  const writable = items.filter((item) => item.editable);
  const readOnly = items.filter((item) => !item.editable);
  const problems = (data?.errors ?? []).filter((item) => item.kind === kind);

  const openCreate = () => {
    setDetail(null);
    setFormOpen(true);
  };

  const openEdit = async (asset: AssetView): Promise<void> => {
    const loaded = await read({ kind, path: asset.path });
    if (!loaded) return;
    setDetail(loaded);
    setFormOpen(true);
  };

  const askDelete = async (target: { name: string; path: string }): Promise<void> => {
    const ok = await confirm({
      title: t("删除 {{name}}？", { name: target.name }),
      description:
        kind === "skill"
          ? t("技能目录连同其中的引用文件、脚本一并删除，无法撤销。")
          : t("文件从磁盘上删除，无法撤销。"),
      // 确认按钮写清删的是什么：行内也有一个「删除」，同一个词会让人看错点错
      confirmText:
        kind === "agent" ? t("删除角色") : kind === "skill" ? t("删除技能") : t("删除命令"),
      destructive: true,
    });
    if (ok) await remove({ kind, path: target.path });
  };

  const createButton = (
    <Button variant="outline" size="sm" onClick={openCreate}>
      <Plus className="size-icon-base" />
      {createLabel}
    </Button>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <SettingsSectionHeader
          title={t("本机与项目")}
          meta={t("{{count}} 项", { count: writable.length })}
          action={createButton}
        />

        {data !== null && items.length === 0 ? (
          <Empty
            className="rounded-xl border border-dashed px-6 py-9"
            icon={<Icon className="size-icon-lg" />}
            title={emptyTitle}
            hint={emptyDescription}
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-icon-base" />
                {createLabel}
              </Button>
            }
          />
        ) : null}

        {items.length > 0 ? (
          <SettingsGroup>
            {writable.length > 0 ? (
              writable.map((item) => (
                <AssetListItem
                  key={item.path}
                  asset={item}
                  onEdit={(asset) => void openEdit(asset)}
                  onDelete={(asset) => void askDelete(asset)}
                />
              ))
            ) : (
              <p className="px-4 py-3 text-sm text-foreground-subtle">
                {t("本机与项目里还没有自定义项。")}
              </p>
            )}
          </SettingsGroup>
        ) : null}
      </div>

      {readOnly.length > 0 ? (
        <div className="space-y-3">
          <SettingsSectionHeader
            title={t("插件与内置")}
            meta={t("{{count}} 项", { count: readOnly.length })}
          />
          <SettingsGroup>
            {readOnly.map((item) => (
              <AssetListItem
                key={item.path}
                asset={item}
                onEdit={(asset) => void openEdit(asset)}
                onDelete={(asset) => void askDelete(asset)}
              />
            ))}
          </SettingsGroup>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-destructive/40 px-4 py-3">
          <p className="text-sm font-medium text-destructive">{t("有无法解析的文件：")}</p>
          {problems.map((item) => (
            <p key={item.path} className="font-mono text-xs break-all text-foreground-subtle">
              {item.path} — {item.reason}
            </p>
          ))}
        </div>
      ) : null}

      {formOpen ? (
        <AssetFormDialog
          kind={kind}
          detail={detail}
          projectAvailable={cwd !== null}
          onOpenChange={(open) => {
            if (!open) setFormOpen(false);
          }}
          onSubmit={save}
          onDelete={(target) => void askDelete(target)}
        />
      ) : null}
    </div>
  );
}
