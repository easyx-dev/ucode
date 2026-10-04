/** 编辑器上方的附件行：图片缩略图（点开预览）、其它类型文件 chip，均可移除 */
import { API_BASE_PATH, type AttachmentView } from "@ucode/contracts";
import { FileText, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

type AttachmentStripProps = {
  attachments: AttachmentView[];
  onRemove: (id: string) => void;
};

const urlOf = (id: string): string => `${API_BASE_PATH}/attachments/${id}`;

export function AttachmentStrip({ attachments, onRemove }: AttachmentStripProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<AttachmentView | null>(null);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2.5">
      {attachments.map((item) => (
        <div key={item.id} className="relative">
          {item.kind === "image" ? (
            <button
              type="button"
              onClick={() => setPreview(item)}
              title={item.name ?? item.id}
              className="block size-14 overflow-hidden rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <img src={urlOf(item.id)} alt={item.name ?? ""} className="size-full object-cover" />
            </button>
          ) : (
            <div className="flex h-14 max-w-40 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground">
              <FileText className="size-4 shrink-0" />
              <span className="truncate" title={item.name ?? item.id}>
                {item.name ?? item.id}
              </span>
            </div>
          )}
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
              src={urlOf(preview.id)}
              alt={preview.name ?? ""}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
