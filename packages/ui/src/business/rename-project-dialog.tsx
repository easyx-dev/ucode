/**
 * 重命名项目弹层：函数式入口 `openRenameProjectDialog`，组件本体只管表单。
 *
 * 挂载即打开、收起即结算：待改名的项目在入队时就定了，不必再受控 open。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../base/dialog";
import { Input } from "../base/input";
import { openDialog } from "../lib/dialog";
import { baseName } from "../lib/path";

type RenameProjectDialogProps = {
  /** 项目目录；与 `name` 一起定位那个项目行 */
  path: string;
  /** 当前展示名；为空表示还没起过名 */
  name: string | null;
  /** 提交新名称；`null` 表示清空（回落目录末段） */
  onSubmit: (name: string | null) => void;
  /** 取消 / Esc / 点遮罩：不改名收起 */
  onCancel: () => void;
};

export function RenameProjectDialog({ path, name, onSubmit, onCancel }: RenameProjectDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(() => name ?? baseName(path));

  const submit = (): void => {
    const trimmed = value.trim();
    onSubmit(trimmed || null);
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
          <DialogTitle>{t("重命名项目")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <p className="text-xs text-muted-foreground">{t("留空即用目录名")}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("取消")}
          </Button>
          <Button onClick={submit}>{t("保存")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 打开重命名弹层；返回新名称（清空为 null），取消返回 undefined */
export const openRenameProjectDialog = (input: {
  path: string;
  name: string | null;
}): Promise<string | null | undefined> =>
  openDialog<string | null>((close) => (
    <RenameProjectDialog
      path={input.path}
      name={input.name}
      onSubmit={(name) => close(name)}
      onCancel={() => close()}
    />
  ));
