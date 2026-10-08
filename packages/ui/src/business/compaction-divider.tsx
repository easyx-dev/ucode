/**
 * 上下文压缩的分隔行：标出「此前的历史已被摘要替代」，并说明这次压缩是怎么触发的。
 *
 * 摘要默认展开——压缩会重写可见历史，它是被替代掉那段的唯一凭据，藏着等于让人以为什么都没发生；
 * 想只留一行细线时可以收起。跳过与失败没有摘要，只出文案。
 */
import type { CompactionRecord } from "@ucode/contracts";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { compactionLineDetail, compactionLineText } from "../lib/compaction";
import { DividerLine } from "./divider-line";

export function CompactionDivider({
  summary,
  record,
}: {
  summary: string;
  record?: CompactionRecord;
}) {
  const { t } = useTranslation();
  const hasSummary = summary.trim().length > 0;

  return (
    <DividerLine
      label={compactionLineText(record, t)}
      detail={compactionLineDetail(record, t)}
      defaultOpen={hasSummary}
    >
      {hasSummary ? <Markdown remarkPlugins={[remarkGfm]}>{summary}</Markdown> : undefined}
    </DividerLine>
  );
}
