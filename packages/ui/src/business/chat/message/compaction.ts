/**
 * 压缩的展示辅助：把「压缩的结果提示」翻成一句人话，并给对话里那行分隔行取文案。
 *
 * 成功不需要额外提示（可见历史会自己收缩成摘要 + 保留区间）；需要说话的是两类——
 * 正常拒绝（没做任何事）与自动压缩失败（上下文已经逼近窗口但没压下去）。
 * 服务端只给原因，文案由各端按当前语言渲染（服务端不做本地化）。
 */
import type { CompactionNotice, CompactionRecord } from "@ucode/contracts";
import type { TFunction } from "i18next";
import { formatTokens } from "../../../utils/usage";

export const compactionNoticeMessage = (notice: CompactionNotice, t: TFunction): string => {
  if (notice.kind === "busy") return t("会话正在生成，等这一轮结束再压缩");
  if (notice.kind === "failed") {
    return t("自动压缩失败：{{reason}}", { reason: notice.reason });
  }
  return compactionSkipText(notice.reason, t);
};

/** 正常拒绝的文案：两种原因各一句，提示与分隔行共用同一口径 */
const compactionSkipText = (reason: "too_small" | "already_compacted", t: TFunction): string =>
  reason === "already_compacted"
    ? t("当前上下文已经是压缩后的状态，无需重复压缩")
    : t("当前上下文已经很紧凑，无需压缩");

/**
 * 对话里那行压缩分隔行的文案：真压了就是「对话已压缩」，没压成 / 压失败得说清楚，
 * 否则历史里只留一条看不出所以然的线。
 */
export const compactionLineText = (record: CompactionRecord | undefined, t: TFunction): string => {
  if (!record || record.outcome === "done") return t("对话已压缩");
  if (record.outcome === "failed") {
    return t("压缩失败：{{reason}}", { reason: record.error ?? t("未知原因") });
  }
  return compactionSkipText(
    record.skip === "already_compacted" ? "already_compacted" : "too_small",
    t,
  );
};

/** 分隔行右侧的补充：触发来源与规模变化（「阈值触发 · 12.3k → 4.1k」）；没有记录时为 null */
export const compactionLineDetail = (
  record: CompactionRecord | undefined,
  t: TFunction,
): string | null => {
  if (record?.outcome !== "done") return null;
  const reason =
    record.reason === "manual"
      ? t("手动")
      : record.reason === "overflow"
        ? t("超窗口")
        : t("达阈值");
  if (record.tokensBefore === undefined || record.tokensAfter === undefined) return reason;
  return `${reason} · ${formatTokens(record.tokensBefore)} → ${formatTokens(record.tokensAfter)}`;
};
