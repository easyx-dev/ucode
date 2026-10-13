/**
 * 模型请求重试的细线：告诉用户「请求失败过一次、正在等一会儿重试」，或「重试到底仍然失败」。
 *
 * 重试成功的那条不下发（紧接着就是正常输出），所以界面上只会出现这两种。
 * 错误文本来自上游响应体，按外部不可信内容对待：纯文本、截断展示，不渲染任何标记。
 */
import type { RetryRecord } from "@ucode/contracts";
import { useTranslation } from "react-i18next";
import { DividerLine } from "../../../base/divider-line";

/** 错误文本的展示上限：上游偶尔会带整页 HTML 或堆栈 */
const ERROR_MAX_LENGTH = 120;

export function RetryLine({ record }: { record: RetryRecord }) {
  const { t } = useTranslation();
  const error = record.errorMessage?.trim().slice(0, ERROR_MAX_LENGTH);

  if (record.event === "start") {
    const seconds = Math.max(1, Math.round((record.delayMs ?? 0) / 1000));
    return (
      <DividerLine
        label={t("模型请求失败，{{seconds}}s 后重试（第 {{attempt}}/{{maxAttempts}} 次）", {
          seconds,
          attempt: record.attempt,
          maxAttempts: record.maxAttempts,
        })}
        detail={error}
      />
    );
  }
  return (
    <DividerLine
      label={t("重试 {{attempt}} 次仍失败", { attempt: record.attempt })}
      detail={error}
    />
  );
}
