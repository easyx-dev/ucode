/** 模型设置里的一条模型：单行摘要 + 右侧动作，字段编辑在 ModelFormDialog 里 */
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../base/badge";
import { Button } from "../../../base/button";
import { Switch } from "../../../base/switch";
import type { DraftModel } from "../config-draft";

type ModelRowProps = {
  model: DraftModel;
  onEdit: () => void;
  onToggleReasoning: (enabled: boolean) => void;
  onRemove: () => void;
};

/** 上下文窗口的紧凑写法：128000 → 128K，1000000 → 1M；读不出数就不出徽标 */
const contextLabel = (raw: string): string | null => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  return `${Math.round(value / 1000)}K`;
};

export function ModelRow({ model, onEdit, onToggleReasoning, onRemove }: ModelRowProps) {
  const { t } = useTranslation();
  const context = contextLabel(model.contextWindow);

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">
        {model.id.trim() || t("未命名模型")}
      </span>
      {context ? <Badge variant="secondary">{context}</Badge> : null}
      {model.input.includes("image") ? <Badge variant="secondary">{t("视觉")}</Badge> : null}
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={t("编辑模型")} onClick={onEdit}>
          <Pencil className="size-icon-sm" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("删除模型")} onClick={onRemove}>
          <Trash2 className="size-icon-sm text-destructive" />
        </Button>
        <Switch
          checked={model.reasoning}
          onCheckedChange={onToggleReasoning}
          aria-label={t("思考")}
        />
      </div>
    </div>
  );
}
