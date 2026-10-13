/**
 * 确认框与单按钮提示的渲染实现，由 `DialogHost` 按队列渲染。
 *
 * 调用方用 `business/dialog/queue` 的 `confirm` / `alert`；这里挂载即打开、收起即结算，不持有 open 状态。
 */
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../base/dialog";
import type { AlertOptions, ConfirmOptions } from "./queue";

type ConfirmDialogProps =
  | { variant: "confirm"; options: ConfirmOptions; onResolve: (confirmed: boolean) => void }
  | { variant: "alert"; options: AlertOptions; onResolve: () => void };

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useTranslation();
  const { title, description } = props.options;
  const cancelText = props.variant === "confirm" ? (props.options.cancelText ?? t("取消")) : null;
  const confirmText =
    props.options.confirmText ?? (props.variant === "confirm" ? t("确定") : t("知道了"));
  const destructive = props.variant === "confirm" && props.options.destructive === true;

  const cancel = (): void => {
    if (props.variant === "confirm") props.onResolve(false);
    else props.onResolve();
  };
  const accept = (): void => {
    if (props.variant === "confirm") props.onResolve(true);
    else props.onResolve();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          {cancelText === null ? null : (
            <Button variant="outline" onClick={cancel}>
              {cancelText}
            </Button>
          )}
          {/* 焦点落在确认按钮上：Enter 即确认，Esc 仍是取消 */}
          <Button variant={destructive ? "destructive" : "default"} autoFocus onClick={accept}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
