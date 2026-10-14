/**
 * 复制会话原始记录（JSONL）：内容要现取（可达几 MB），所以按钮自己去加载再复制。
 *
 * 与 `CopyAction` 同一套反馈：成功换对勾并保持片刻，失败保持原状并复位——取不到记录时静默，
 * 按钮还在，用户可以再点一次（弹一条错误提示比失败本身更打扰人）。
 */
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../base/button";
import { useCopyFeedback } from "../../base/copy-action";

type CopyTranscriptActionProps = {
  /** 取会话原始记录；拿不到时抛错 */
  load: () => Promise<string>;
};

export function CopyTranscriptAction({ load }: CopyTranscriptActionProps) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyFeedback();
  const [loading, setLoading] = useState(false);

  const label = copied ? t("已复制") : loading ? t("复制中…") : t("复制会话记录");

  const loadAndCopy = async (): Promise<void> => {
    setLoading(true);
    try {
      copy(await load());
    } catch {
      // 记录过大 / 文件已不在：只把加载态收回去
    } finally {
      setLoading(false);
    }
  };

  return (
    <IconButton disabled={loading} label={label} onClick={() => void loadAndCopy()}>
      {loading ? (
        <Loader2 className="size-icon-sm animate-spin" />
      ) : copied ? (
        <Check className="size-icon-sm" />
      ) : (
        <Copy className="size-icon-sm" />
      )}
    </IconButton>
  );
}
