/**
 * 上下文压缩的分隔行：标出「此前的历史已被摘要替代」，并说明这次压缩是怎么触发的。
 *
 * 默认收起成一行细线——行本身已经说明「此处被压缩过」，摘要是回看时才需要的细节，常驻展开会把
 * 历史挤成两段。有摘要时点开可看，跳过与失败没有摘要，只出文案。
 */
import type { CompactionRecord } from "@ucode/contracts";
import { useTranslation } from "react-i18next";
import { compactionLineDetail, compactionLineText } from "../lib/compaction";
import { DividerLine } from "./divider-line";
import { MessageResponse } from "./message-response";

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
    <DividerLine label={compactionLineText(record, t)} detail={compactionLineDetail(record, t)}>
      {hasSummary ? <MessageResponse text={summary} /> : undefined}
    </DividerLine>
  );
}
