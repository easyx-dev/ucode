/**
 * 复制一段文本：成功后图标换成对勾并保持片刻；反馈状态机（`useCopyFeedback`）也内聚在这里。
 *
 * 复制失败静默保持原状——它不是关键路径（非安全上下文、无权限、剪贴板被别的程序占着都可能失败），
 * 为它弹一条错误提示比失败本身更打扰人。消息页脚、用户消息与代码块直接用 `CopyAction`；
 * 远程访问与表格只要这套反馈、不要这个图标时，用同文件导出的 hook。
 */
import { cn } from "cn";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../utils/clipboard";
import { IconButton } from "./button";

/** 复制成功后的提示时长；够看清换了图标，又不至于一直占着「已复制」 */
const COPIED_HINT_MS = 1500;

type CopyFeedback = {
  /** 刚复制成功 */
  copied: boolean;
  /** 复制一段文本；成功才置位 `copied` */
  copy: (text: string) => void;
  /** 立刻清掉「已复制」：内容换了之后，上一次的反馈不该留在界面上 */
  reset: () => void;
};

/**
 * 复制反馈：成功后置位、约 1.5s 后自动复位。
 *
 * 不单独成文件、也不上提到 `hooks/`：它就是这个原语的内部状态，只有共用 `CopyAction` 的场合才需要它。
 */
export const useCopyFeedback = (): CopyFeedback => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback((text: string) => {
    void copyText(text).then(setCopied);
  }, []);

  const reset = useCallback(() => setCopied(false), []);

  return { copied, copy, reset };
};

type CopyActionProps = {
  /** 定位与底色的类名（消息页脚 / 代码块浮层各不一样） */
  className?: string;
  /** 要复制的文本 */
  text: string;
};

export function CopyAction({ className, text }: CopyActionProps) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyFeedback();

  return (
    <IconButton
      className={cn("text-foreground-subtle hover:text-foreground", className)}
      label={copied ? t("已复制") : t("复制")}
      size="icon-xs"
      onClick={() => copy(text)}
    >
      {copied ? <Check className="size-icon-sm" /> : <Copy className="size-icon-sm" />}
    </IconButton>
  );
}
