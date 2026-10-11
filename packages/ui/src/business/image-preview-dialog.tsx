/**
 * 图片全屏预览：全应用唯一的图片预览弹层，正文里的图片、附件 token 与编辑器里的图片 token 都开它。
 *
 * `source` 可以是附件 id（或附件路由地址）——凭证只在 `Authorization` 头里，浏览器不会给 `<img src>`
 * 附自定义头，故字节由弹层自己经 `useAttachmentUrl` 取回；已经是 blob / 外链的来源原样用。
 * 看细节的交互（拖拽平移、缩放）与图表共用 `ZoomablePreview`。
 * 打开走 `openImagePreview`，调用方不持有开关（见 docs/components.md 的弹层调用方式）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAttachmentUrl } from "../hooks/use-attachment-url";
import { openDialog } from "../lib/dialog";
import { FullscreenDialog } from "./fullscreen-dialog";
import { ZoomablePreview } from "./zoomable-preview";

export function ImagePreviewDialog({
  alt,
  onClose,
  source,
}: {
  /** 图片说明：同时作弹层标题与 `alt` */
  alt?: string;
  onClose: () => void;
  /** 附件 id、附件路由地址或图片外链 */
  source: string;
}) {
  const { t } = useTranslation();
  const { failed, url } = useAttachmentUrl(source);
  const [loaded, setLoaded] = useState(false);
  const label = alt?.trim() ? alt : t("图片预览");

  if (!url) {
    // 字节没到之前没有可缩放的内容：这里只给骨架或失败说明，别让弹层空着
    return (
      <FullscreenDialog description={t("图片全屏预览")} onClose={onClose} title={label}>
        <div className="flex min-h-0 items-center justify-center bg-background p-4">
          {failed ? (
            <p className="text-sm text-foreground-subtle">{t("图片不可用")}</p>
          ) : (
            <div className="h-[60vh] w-full max-w-xl animate-pulse rounded-md bg-muted/40" />
          )}
        </div>
      </FullscreenDialog>
    );
  }

  return (
    <ZoomablePreview
      contentReady={loaded}
      description={t("图片全屏预览：拖拽平移，Ctrl 加滚轮缩放")}
      onClose={onClose}
      title={label}
    >
      <img
        alt={alt ?? ""}
        className="block max-w-none select-none"
        draggable={false}
        onLoad={() => setLoaded(true)}
        src={url}
      />
    </ZoomablePreview>
  );
}

/** 打开图片全屏预览；`alt` 缺省时标题回落为「图片预览」 */
export const openImagePreview = (target: { alt?: string | null; source: string }): void => {
  void openDialog((close) => (
    <ImagePreviewDialog
      alt={target.alt ?? undefined}
      onClose={() => close()}
      source={target.source}
    />
  ));
};
