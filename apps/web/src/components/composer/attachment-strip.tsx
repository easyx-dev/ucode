/** 编辑器上方的附件行：图片缩略图（点开预览）+ 悬停删除 */
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ComposerAttachment } from "@/components/composer/use-composer-attachments";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type AttachmentStripProps = {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
};

export function AttachmentStrip({ attachments, onRemove }: AttachmentStripProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ComposerAttachment | null>(null);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2.5">
      {attachments.map((item) => (
        <div key={item.id} className="relative">
          <button
            type="button"
            onClick={() => setPreview(item)}
            title={item.name}
            className="block size-14 overflow-hidden rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <img src={item.url} alt={item.name} className="size-full object-cover" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            title={t("移除附件")}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>{t("图片预览")}</DialogTitle>
          {preview ? (
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
