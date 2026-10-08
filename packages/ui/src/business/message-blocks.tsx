/**
 * 消息内容块的渲染：正文、图片、附件。用户消息与 assistant 消息共用这一套。
 *
 * 图片先取回字节再渲染（浏览器不会给 `<img src>` 附凭证），附件同理——字节到位前不可点，
 * 取不到就标成不可用，不让内容凭空消失。思考区块与工具调用由 activity 聚合行渲染，这里不兜底。
 */
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAttachmentUrl } from "../hooks/use-attachment-url";
import type { MessageBlock } from "../lib/types";

/** 图片块：先取回字节再渲染 */
export function BlockImage({ url }: { url: string }) {
  const { t } = useTranslation();
  const { url: source, failed } = useAttachmentUrl(url);
  if (!source) {
    // 取不到字节（会话失效 / 字节已不在）时给一行说明，别让消息里的图凭空消失
    return failed ? <p className="my-2 text-xs text-muted-foreground">{t("图片不可用")}</p> : null;
  }
  return (
    <a href={source} target="_blank" rel="noreferrer" className="my-2 inline-block">
      <img
        src={source}
        alt=""
        loading="lazy"
        className="max-h-96 rounded-md border border-border"
      />
    </a>
  );
}

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
      {withIcon ? <FileText className="size-3 shrink-0" /> : null}
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

/** markdown 正文里的图片：本站附件走 blob，外链原样使用 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation();
  const { url: source, failed } = useAttachmentUrl(src ?? "");
  if (!source) {
    return failed ? <span className="text-xs text-muted-foreground">{t("图片不可用")}</span> : null;
  }
  return (
    <img
      src={source}
      alt={alt ?? ""}
      loading="lazy"
      className="max-h-96 rounded-md border border-border"
    />
  );
}

export function BlockView({ block, live }: { block: MessageBlock; live?: boolean }) {
  // 思考区块与工具调用已由 activity 聚合行渲染，这里不再兜底
  if (block.type === "thinking" || block.type === "toolCall") return null;
  if (block.type === "image") return <BlockImage url={block.url} />;
  if (block.type === "file") {
    return (
      <AttachmentLink
        id={block.id}
        name={block.name}
        className="my-1 inline-flex items-center rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
      />
    );
  }
  return (
    <div className="md-content">
      <Markdown remarkPlugins={[remarkGfm]} components={{ img: MarkdownImage }}>
        {block.text}
      </Markdown>
      {live ? (
        <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse bg-foreground align-text-bottom" />
      ) : null}
    </div>
  );
}
