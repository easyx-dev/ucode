/**
 * 正文里的附件文字 token：`<图片 n>` / `<文件名>`，尖括号随 token 一起渲染。
 *
 * 只管形态——包 `button` 开预览还是包 `a` 下载由调用点决定；输入区编辑器与消息回放共用这一套。
 * 中间那截是唯一的语义内容，两侧尖括号对读屏 `aria-hidden`。
 */
import type { AttachmentKind } from "@ucode/contracts";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

const TOKEN_CLASS =
  "inline-flex max-w-48 items-baseline rounded-md border border-border bg-muted/40 px-1 py-px align-baseline font-mono text-xs text-muted-foreground";

export type AttachmentTokenProps = {
  /** 附件类别：图片显示序号，其余显示文件名 */
  kind: AttachmentKind;
  /** 图片的同类序号，1 起（与正文标记 `图片 N` 同口径） */
  index?: number;
  /** 非图片附件的显示名；回退（如 `name || id`）由调用点决定 */
  name?: string | null;
  /** 上传中：淡出一档并脉冲，调用点应同时让它不可点 */
  pending?: boolean;
  className?: string;
};

export function AttachmentToken({ kind, index, name, pending, className }: AttachmentTokenProps) {
  const { t } = useTranslation();
  return (
    <span className={cn(TOKEN_CLASS, pending && "animate-pulse opacity-60", className)}>
      <span aria-hidden>{"<"}</span>
      <span className="min-w-0 truncate">
        {kind === "image" ? t("图片 {{index}}", { index: index ?? 0 }) : (name ?? "")}
      </span>
      <span aria-hidden>{">"}</span>
    </span>
  );
}
