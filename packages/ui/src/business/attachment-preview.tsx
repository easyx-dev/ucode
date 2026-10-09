/**
 * 附件预览的共享层：图片开弹层看原图，非图片由各自的 token 提供下载。
 *
 * 消息回放与编辑器里的图片 token 共用这一份——两处都要「先经客户端取回字节，再渲染」
 * （浏览器不会给 `<img src>` / `<a href>` 附凭证）。用 hook 而非 Provider：预览状态本就是局部的，
 * 弹层挂在用到它的那个 token 上即可，不必为它引入上下文。
 */
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogTitle } from "../base/dialog";
import { useAttachmentUrl } from "../hooks/use-attachment-url";

/** 预览目标：只需要 id（取字节）与显示名（标题 / 下载名） */
export type AttachmentPreviewTarget = { id: string; name?: string | null };

/** 弹层里的原图 */
function PreviewImage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { url: source, failed } = useAttachmentUrl(id);
  if (!source) {
    return failed ? (
      <p className="py-10 text-center text-sm text-muted-foreground">{t("图片不可用")}</p>
    ) : (
      <div className="h-[60vh] w-full animate-pulse rounded-md bg-muted/40" />
    );
  }
  return <img src={source} alt="" className="max-h-[70vh] w-full rounded-md object-contain" />;
}

export function useAttachmentPreview(): {
  open: (target: AttachmentPreviewTarget) => void;
  /** 弹层本体，由调用方渲染在自己的 chip 旁 */
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [target, setTarget] = useState<AttachmentPreviewTarget | null>(null);

  return {
    open: setTarget,
    dialog: (
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>{t("图片预览")}</DialogTitle>
          {target ? <PreviewImage id={target.id} /> : null}
        </DialogContent>
      </Dialog>
    ),
  };
}
