/** 重命名项目对话框 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type RenameProjectDialogProps = {
  /** 待重命名的项目；null 表示关闭 */
  target: { projectId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (projectId: string, name: string) => void;
};

export function RenameProjectDialog({ target, onOpenChange, onSubmit }: RenameProjectDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  useEffect(() => {
    setName(target?.name ?? "");
  }, [target]);

  const submit = () => {
    const trimmed = name.trim();
    if (!target || !trimmed) return;
    onSubmit(target.projectId, trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("重命名项目")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("取消")}
          </Button>
          <Button disabled={!name.trim()} onClick={submit}>
            {t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
