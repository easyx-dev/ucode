/**
 * 模型的字段编辑对话框：模型行只报摘要，明细在这里改。
 *
 * 改的就是草稿（没有「确定 / 取消」两级）——整页的保存与丢弃统一在页头的保存区，
 * 关掉对话框即完成，改动留在草稿里，可以由「取消」一并回滚。
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../base/dialog";
import { Input } from "../../../base/input";
import { Label } from "../../../base/label";
import { Switch } from "../../../base/switch";
import type { DraftModel } from "../config-draft";
import { ModelThinkingLevels } from "./model-thinking-levels";

type ModelFormDialogProps = {
  model: DraftModel;
  onPatch: (patch: Partial<DraftModel>) => void;
  onOpenChange: (open: boolean) => void;
};

export function ModelFormDialog({ model, onPatch, onOpenChange }: ModelFormDialogProps) {
  const { t } = useTranslation();
  const fieldId = useId();

  /** 文本恒在，只有图片可增删 */
  const toggleImage = (enabled: boolean): void =>
    onPatch({ input: enabled ? ["text", "image"] : ["text"] });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{model.id.trim() ? t("编辑模型") : t("添加模型")}</DialogTitle>
          <DialogDescription>
            {t("字段随草稿一起保存；数字留空表示按默认值处理。")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-id`}>{t("模型 id")}</Label>
            <Input
              id={`${fieldId}-id`}
              value={model.id}
              onChange={(event) => onPatch({ id: event.target.value })}
              placeholder="deepseek-v4-flash"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-name`}>{t("显示名")}</Label>
            <Input
              id={`${fieldId}-name`}
              value={model.name}
              onChange={(event) => onPatch({ name: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-window`}>{t("上下文窗口")}</Label>
            <Input
              id={`${fieldId}-window`}
              value={model.contextWindow}
              onChange={(event) => onPatch({ contextWindow: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor={`${fieldId}-budget`}
              title={t("有效上下文预算：到达即自动压缩；留空按窗口推算")}
            >
              {t("上下文预算")}
            </Label>
            <Input
              id={`${fieldId}-budget`}
              value={model.contextBudget}
              placeholder={t("留空自动")}
              onChange={(event) => onPatch({ contextBudget: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-max`}>{t("最大输出")}</Label>
            <Input
              id={`${fieldId}-max`}
              value={model.maxTokens}
              onChange={(event) => onPatch({ maxTokens: event.target.value })}
            />
          </div>

          <fieldset className="flex items-center gap-4">
            <legend className="sr-only">{t("输入类型")}</legend>
            <span aria-hidden className="text-sm text-foreground-subtle">
              {t("输入类型")}
            </span>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-icon-sm accent-primary"
                defaultChecked
                disabled
              />
              {t("文本")}
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-icon-sm accent-primary"
                checked={model.input.includes("image")}
                onChange={(event) => toggleImage(event.target.checked)}
              />
              {t("图片")}
            </label>
          </fieldset>

          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium">{t("思考")}</div>
              <p className="text-sm leading-relaxed text-foreground-subtle">
                {t("该模型支持推理档位；关掉后不再向它传思考档。")}
              </p>
            </div>
            <Switch
              checked={model.reasoning}
              onCheckedChange={(enabled) => onPatch({ reasoning: enabled })}
              aria-label={t("思考")}
            />
          </div>

          {model.reasoning ? <ModelThinkingLevels model={model} onChange={onPatch} /> : null}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("完成")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
