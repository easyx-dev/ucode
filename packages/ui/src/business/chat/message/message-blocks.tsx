/**
 * 消息内容块的渲染：正文、图片、附件。用户消息与 assistant 消息共用这一套。
 *
 * 图片先取回字节再渲染（浏览器不会给 `<img src>` 附凭证），附件同理——字节到位前不可点，
 * 取不到就标成不可用，不让内容凭空消失。思考区块与工具调用由 activity 聚合行渲染，这里不兜底。
 */
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MessageBlock } from "../../../types";
import { AttachmentImage } from "../../attachment/attachment-image";
import { useAttachmentUrl } from "../../attachment/use-attachment-url";
import { MessageResponse } from "../../markdown/message-response";

/** 附件下载入口：给用户消息的附件 chip 与 assistant 产出的文件块共用 */
export function AttachmentLink({
  id,
  name,
  className,
  withIcon = false,
}: {
  id: string;
  name: string;
  className: string;
  withIcon?: boolean;
}) {
  const { t } = useTranslation();
  const { url: source, failed } = useAttachmentUrl(id);
  const label = (
    <>
      {withIcon ? <FileText className="size-icon-xs shrink-0" /> : null}
      {name}
    </>
  );
  if (!source) {
    return (
      <span
        className={`${className} ${failed ? "line-through opacity-60" : "opacity-60"}`}
        title={failed ? t("附件不可用") : name}
      >
        {label}
      </span>
    );
  }
  return (
    <a href={source} download={name} title={name} className={`${className} hover:text-foreground`}>
      {label}
    </a>
  );
}

export function BlockView({ block, live }: { block: MessageBlock; live?: boolean }) {
  // 思考区块与工具调用已由 activity 聚合行渲染，这里不再兜底
  if (block.type === "thinking" || block.type === "toolCall") return null;
  if (block.type === "image") return <AttachmentImage className="my-2 block" url={block.url} />;
  if (block.type === "file") {
    return (
      <AttachmentLink
        id={block.id}
        name={block.name}
        className="my-1 inline-flex items-center rounded-md border border-border px-2 py-1 text-xs text-foreground-subtle"
      />
    );
  }
  return (
    <div className="md-content">
      <MessageResponse text={block.text} live={live} />
    </div>
  );
}
