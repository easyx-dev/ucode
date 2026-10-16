/**
 * 重命名会话弹层：函数式入口 `openRenameSessionDialog`，组件本体只管表单。
 *
 * 挂载即打开、收起即结算：待改名的会话在入队时就定了，不必再受控 open。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../base/dialog";
import { Input } from "../../base/input";
import type { SessionSummary } from "../../types";
import { openDialog } from "../dialog/queue";

type RenameSessionDialogProps = {
  /** 待重命名的会话；已有名字时作为初始值 */
  session: SessionSummary;
  /** 提交新名称（已 trim、非空） */
  onSubmit: (name: string) => void;
  /** 取消 / Esc / 点遮罩：不改名收起 */
  onCancel: () => void;
};

export function RenameSessionDialog({ session, onSubmit, onCancel }: RenameSessionDialogProps) {
  const { t } = useTranslation();
  // 未命名的会话不预填首条用户消息：标题本来就不取它，预填一句提问反而与列表显示的名字不一致
  const [name, setName] = useState(() => session.name ?? "");

  const submit = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("重命名会话")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          placeholder={t("新会话")}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
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

/** 打开重命名弹层；返回用户填的新名称，取消返回 null */
export const openRenameSessionDialog = (session: SessionSummary): Promise<string | null> =>
  openDialog<string>((close) => (
    <RenameSessionDialog
      session={session}
      onSubmit={(name) => close(name)}
      onCancel={() => close()}
    />
  )).then((name) => name ?? null);
