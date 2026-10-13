/**
 * 附件图片：先取回字节再渲染，点图或点右上角按钮全屏查看。
 *
 * 浏览器不会给 `<img src>` 附凭证，所以本站图片一律先经 `useAttachmentUrl` 取回字节；消息里的图片块与
 * markdown 正文里的图片共用这一份。容器用 `span` 而不是 `div`：正文里的图片常常落在 `<p>` 里，
 * 块级元素会把段落拆开。
 */
import { cn } from "cn";
import { Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToolbarIconButton } from "../../base/toolbar-icon-button";
import { openImagePreview } from "./image-preview-dialog";
import { useAttachmentUrl } from "./use-attachment-url";

export function AttachmentImage({
  alt,
  className,
  url,
}: {
  /** 图片说明：作 alt，也作全屏弹层的标题 */
  alt?: string;
  /** 外层定位用的额外类名（如段落间距） */
  className?: string;
  /** 附件 id、附件路由地址或外链 */
  url: string;
}) {
  const { t } = useTranslation();
  const { url: source, failed } = useAttachmentUrl(url);
  if (!source) {
    // 取不到字节（会话失效 / 字节已不在）时给一行说明，别让消息里的图凭空消失
    return failed ? (
      <span className="text-xs text-foreground-subtle">{t("图片不可用")}</span>
    ) : null;
  }

  const open = (): void => {
    openImagePreview({ alt, source });
  };

  return (
    <span className={cn("group/image relative inline-block", className)}>
      <button className="block cursor-zoom-in" onClick={open} type="button">
        <img
          alt={alt ?? ""}
          className="max-h-96 rounded-md border border-border"
          loading="lazy"
          src={source}
        />
      </button>
      <ToolbarIconButton
        className="absolute top-2 right-2 bg-card/80 opacity-0 backdrop-blur-sm transition group-hover/image:opacity-100 focus-visible:opacity-100"
        label={t("全屏查看")}
        onClick={open}
      >
        <Maximize2 />
      </ToolbarIconButton>
    </span>
  );
}
