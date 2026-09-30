/** 模型设置对话框：装配草稿状态与提交动作，保存成功后关闭 */
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsBody } from "@/components/settings/settings-body";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfigDraft } from "@/hooks/use-config-draft";
import { useConfigSave } from "@/hooks/use-config-save";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存成功后的回调：刷新模型目录与会话列表 */
  onSaved: () => void;
};

export function SettingsDialog({ open, onOpenChange, onSaved }: SettingsDialogProps) {
  const { t } = useTranslation();
  const draft = useConfigDraft(open);
  const { saving, testingKey, save, test } = useConfigSave(draft, onSaved);

  const handleSave = async () => {
    if (await save()) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("设置")}</DialogTitle>
          <DialogDescription>{t("设置.说明")}</DialogDescription>
        </DialogHeader>

        {/*
          主体用原生 overflow-y-auto 而非 ScrollArea：ScrollArea 的 viewport 靠 `height: 100%` 撑高，
          而本对话框的高度由 `max-h` 决定（不是 definite 高度），百分比无法解析，滚动区只会撑破对话框。
          flex 子项自带确定的使用高度，配合 `min-h-0` 才能真正收缩并滚动。
        */}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <SettingsBody draft={draft} testingKey={testingKey} onTest={test} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("取消")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || draft.loading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("保存并生效")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
