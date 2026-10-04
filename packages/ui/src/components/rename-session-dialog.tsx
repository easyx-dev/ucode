/** 重命名会话对话框 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

type RenameSessionDialogProps = {
  /** 待重命名的会话；null 表示关闭 */
  target: { sessionId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (sessionId: string, name: string) => void;
};

export function RenameSessionDialog({ target, onOpenChange, onSubmit }: RenameSessionDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  useEffect(() => {
    setName(target?.name ?? "");
  }, [target]);

  const submit = () => {
    const trimmed = name.trim();
    if (!target || !trimmed) return;
    onSubmit(target.sessionId, trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("重命名会话")}</DialogTitle>
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
