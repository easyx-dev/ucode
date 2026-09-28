/** 模型设置对话框：装配草稿状态与提交动作，保存成功后关闭 */
import { Loader2 } from "lucide-react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfigDraft } from "@/hooks/use-config-draft";
import { useConfigSave } from "@/hooks/use-config-save";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存成功后的回调：刷新模型目录与会话列表 */
  onSaved: () => void;
};

export function SettingsDialog({ open, onOpenChange, onSaved }: SettingsDialogProps) {
  const draft = useConfigDraft(open);
  const { saving, testingKey, save, test } = useConfigSave(draft, onSaved);

  const handleSave = async () => {
    if (await save()) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>模型设置</DialogTitle>
          <DialogDescription>
            配置 OpenAI 兼容端点。保存后会重建 pi 运行时；apiKey 留空表示沿用已保存的 key。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-1 flex-1 px-1">
          <SettingsBody draft={draft} testingKey={testingKey} onTest={test} />
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || draft.loading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            保存并生效
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
