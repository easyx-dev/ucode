/** 重命名会话对话框 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type RenameSessionDialogProps = {
  /** 待重命名的会话；null 表示关闭 */
  target: { sessionId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (sessionId: string, name: string) => void;
};

export function RenameSessionDialog({ target, onOpenChange, onSubmit }: RenameSessionDialogProps) {
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
          <DialogTitle>重命名会话</DialogTitle>
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
            取消
          </Button>
          <Button disabled={!name.trim()} onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
