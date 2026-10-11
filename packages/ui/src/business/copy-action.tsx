/**
 * 复制一段文本：成功后图标换成对勾并保持片刻。
 *
 * 失败（非安全上下文、无权限、剪贴板被别的程序占着）静默保持原状——复制不是关键路径，
 * 为它弹一条错误提示比失败本身更打扰人；兜底走 `lib/clipboard`，两条路都试过。
 * 消息页脚与代码块共用它，定位与底色的类名由调用方从 `className` 传。
 */
import { cn } from "cn";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../lib/clipboard";

/** 复制成功后的提示时长；够看清换了图标，又不至于一直占着「已复制」 */
const COPIED_HINT_MS = 1500;

export function CopyAction({ className, text }: { className?: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded p-1 text-foreground-subtle hover:bg-state-hover hover:text-foreground",
        className,
      )}
      title={copied ? t("已复制") : t("复制")}
      onClick={() => {
        void copyText(text).then((ok) => setCopied(ok));
      }}
    >
      {copied ? <Check className="size-icon-sm" /> : <Copy className="size-icon-sm" />}
    </button>
  );
}
