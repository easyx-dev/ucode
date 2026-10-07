/**
 * 压缩的展示辅助：把「压缩的结果提示」翻成一句人话。
 *
 * 成功不需要提示（可见历史会自己收缩成摘要 + 保留区间）；需要说话的是两类——
 * 正常拒绝（没做任何事）与自动压缩失败（上下文已经逼近窗口但没压下去）。
 * 服务端只给原因，文案由各端按当前语言渲染（服务端不做本地化）。
 */
import type { CompactionNotice } from "@ucode/contracts";
import type { TFunction } from "i18next";

export const compactionNoticeMessage = (notice: CompactionNotice, t: TFunction): string => {
  if (notice.kind === "busy") return t("会话正在生成，等这一轮结束再压缩");
  if (notice.kind === "failed") {
    return t("自动压缩失败：{{reason}}", { reason: notice.reason });
  }
  return notice.reason === "already_compacted"
    ? t("当前上下文已经是压缩后的状态，无需重复压缩")
    : t("当前上下文已经很紧凑，无需压缩");
};
