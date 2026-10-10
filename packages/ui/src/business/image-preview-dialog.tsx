/**
 * 图片全屏预览：原图按容器等比缩放，不裁切、不放大到模糊。
 */
import { useTranslation } from "react-i18next";
import { FullscreenDialog } from "./fullscreen-dialog";

export function ImagePreviewDialog({
  alt,
  onClose,
  src,
}: {
  alt?: string;
  onClose: () => void;
  src: string;
}) {
  const { t } = useTranslation();
  const label = alt?.trim() ? alt : t("图片预览");

  return (
    <FullscreenDialog
      description={t("图片全屏预览：按容器等比缩放")}
      onClose={onClose}
      title={label}
    >
      <div className="flex min-h-0 items-center justify-center overflow-auto bg-background p-4">
        <img alt={alt ?? ""} className="max-h-full max-w-full object-contain" src={src} />
      </div>
    </FullscreenDialog>
  );
}
