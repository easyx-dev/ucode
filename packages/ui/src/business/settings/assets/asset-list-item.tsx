/**
 * 资产列表的一行：名称、来源与说明在第一行，路径在下面（同名的两条靠它分辨）；
 * 可写档右侧给编辑 / 删除，只读来源只展示。
 */
import type { AssetView, CommandAssetSource } from "@ucode/contracts";
import type { TFunction } from "i18next";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../base/badge";
import { Button } from "../../../base/button";

/** 来源 → 界面标签；只看「这条从哪来」，同名优先级靠列表顺序与覆盖提示表达 */
const sourceLabel = (source: CommandAssetSource, t: TFunction): string => {
  if (source === "project") return t("当前项目");
  if (source === "agents-project") return t("项目 .agents");
  if (source === "global") return t("全局");
  if (source === "agents-user") return t("用户 .agents");
  if (source === "plugin") return t("插件");
  return t("内置");
};

type AssetListItemProps = {
  asset: AssetView;
  onEdit: (asset: AssetView) => void;
  onDelete: (asset: AssetView) => void;
};

export function AssetListItem({ asset, onEdit, onDelete }: AssetListItemProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{asset.label}</span>
          <Badge variant="outline">{sourceLabel(asset.source, t)}</Badge>
          {asset.active ? null : (
            <span className="text-xs text-foreground-subtle">
              {t("被同名项覆盖：{{path}}", { path: asset.overriddenBy ?? "" })}
            </span>
          )}
        </div>
        {asset.description ? (
          <p className="truncate text-sm text-foreground-subtle" title={asset.description}>
            {asset.description}
          </p>
        ) : null}
        <p className="truncate font-mono text-xs text-foreground-subtle">{asset.path}</p>
      </div>

      {asset.editable ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("编辑")}
            onClick={() => onEdit(asset)}
          >
            <Pencil className="size-icon-base" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("删除")}
            onClick={() => onDelete(asset)}
          >
            <Trash2 className="size-icon-base" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
