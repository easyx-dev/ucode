/**
 * 正文里的附件 token：图片是 `图片<序号>`、其余是文件名，前面带一枚类型图标。
 *
 * 只管形态——包 `button` 开预览还是包 `a` 下载由调用点决定；输入区编辑器与消息回放共用这一套。
 * 序号 / 文件名是唯一的语义内容，图标对读屏 `aria-hidden`。
 */
import type { AttachmentKind } from "@ucode/contracts";
import { cn } from "cn";
import { FileImage } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fileIconOf } from "../lib/file-icons";

const TOKEN_CLASS =
  "inline-flex max-w-48 items-baseline gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 align-baseline font-mono text-xs text-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:self-center";

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
  // 文件按显示名认类型（认不出给通用文件图标）；图片一律同一枚，别按扩展名分家
  const Icon = kind === "image" ? FileImage : fileIconOf(name ?? "");
  return (
    <span className={cn(TOKEN_CLASS, pending && "animate-pulse opacity-60", className)}>
      <Icon aria-hidden />
      <span className="min-w-0 truncate">
        {kind === "image" ? t("图片{{index}}", { index: index ?? 0 }) : (name ?? "")}
      </span>
    </span>
  );
}
