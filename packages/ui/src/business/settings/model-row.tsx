/** 模型设置里的一条模型：基础字段 + 输入类型 + 推理等级映射 */
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Input } from "../../base/input";
import { Label } from "../../base/label";
import type { DraftModel } from "../../lib/config-draft";
import { ModelThinkingLevels } from "./model-thinking-levels";

type ModelRowProps = {
  model: DraftModel;
  onChange: (patch: Partial<DraftModel>) => void;
  onRemove: () => void;
};

export function ModelRow({ model, onChange, onRemove }: ModelRowProps) {
  const { t } = useTranslation();

  const toggleImage = (enabled: boolean) => {
    // 文本恒在，只有图片可增删
    onChange({ input: enabled ? ["text", "image"] : ["text"] });
  };

  return (
    <div className="space-y-2 rounded-lg p-2 ring-1 ring-foreground/10">
      {/* 12 列网格：3+3+2+2+1+1 之外再插一栏就会挤到第二行，所以这里用 2+2 留出余量 */}
      <div className="grid items-end gap-2 sm:grid-cols-12">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[11px] text-muted-foreground">{t("模型 id")}</Label>
          <Input
            value={model.id}
            onChange={(event) => onChange({ id: event.target.value })}
            placeholder="deepseek-v4-flash"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[11px] text-muted-foreground">{t("显示名")}</Label>
          <Input value={model.name} onChange={(event) => onChange({ name: event.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[11px] text-muted-foreground">{t("上下文窗口")}</Label>
          <Input
            value={model.contextWindow}
            onChange={(event) => onChange({ contextWindow: event.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label
            className="text-[11px] text-muted-foreground"
            title={t("有效上下文预算：到达即自动压缩；留空按窗口推算")}
          >
            {t("上下文预算")}
          </Label>
          <Input
            value={model.contextBudget}
            placeholder={t("留空自动")}
            onChange={(event) => onChange({ contextBudget: event.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[11px] text-muted-foreground">{t("最大输出")}</Label>
          <Input
            value={model.maxTokens}
            onChange={(event) => onChange({ maxTokens: event.target.value })}
          />
        </div>
        <label className="flex h-8 items-center gap-1.5 text-xs sm:col-span-1">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={model.reasoning}
            onChange={(event) => onChange({ reasoning: event.target.checked })}
          />
          {t("思考")}
        </label>
        <Button
          variant="ghost"
          size="icon-sm"
          className="sm:col-span-1"
          onClick={onRemove}
          title={t("删除模型")}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <fieldset className="flex items-center gap-3">
          <legend className="sr-only">{t("输入类型")}</legend>
          <span aria-hidden className="text-[11px] text-muted-foreground">
            {t("输入类型")}
          </span>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" className="size-3.5 accent-primary" defaultChecked disabled />
            {t("文本")}
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={model.input.includes("image")}
              onChange={(event) => toggleImage(event.target.checked)}
            />
            {t("图片")}
          </label>
        </fieldset>

        {model.reasoning ? <ModelThinkingLevels model={model} onChange={onChange} /> : null}
      </div>
    </div>
  );
}
