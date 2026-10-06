/**
 * 权限审批记录：回放「这次调用当时确认过、结论是什么」。
 *
 * 审批本身只存在于服务端内存（弹窗关掉就没了），记录由服务端落成 `custom` 扩展条目后下发，
 * 这里按「结论 + 调用对象」重新排一段；与提问段同一套排版语言。
 */
import type { PermissionRecord } from "@ucode/contracts";
import { ShieldCheck, ShieldX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatFooter } from "../lib/chat-nodes";
import type { ChatItem } from "../lib/types";
import { MessageFooter } from "./message-footer";
import { toolTitleOf } from "./tool-call";

type PermissionRecordProps = {
  record: PermissionRecord;
  /** 本轮以此收尾时的页脚 */
  footer?: ChatFooter;
  /** 从该条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
};

export function PermissionRecordView({ record, footer, onFork }: PermissionRecordProps) {
  const { t } = useTranslation();
  const allowed = record.decision !== "deny";
  const Icon = allowed ? ShieldCheck : ShieldX;
  const label =
    record.decision === "allow_session"
      ? t("本会话已允许")
      : allowed
        ? t("已允许一次")
        : t("已拒绝");

  return (
    <>
      <div className="rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/10">
        <div
          className={
            allowed
              ? "flex items-center gap-1.5 text-xs text-muted-foreground"
              : "flex items-center gap-1.5 text-xs text-destructive"
          }
        >
          <Icon aria-hidden className="size-3.5 shrink-0" />
          {label}
        </div>
        <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs font-medium text-foreground">
            {toolTitleOf(record.tool, t)}
          </span>
          <span
            className="min-w-0 truncate font-mono text-xs text-muted-foreground"
            title={record.subject}
          >
            {record.subject}
          </span>
        </div>
        {/* 「本会话恒允」的范围值得写出来：它决定了后续哪些同类调用不再询问 */}
        {record.decision === "allow_session" && record.scope ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("{{scope}} 在本会话内不再询问", { scope: record.scope })}
          </p>
        ) : null}
        {/* 子会话在子会话自己那边执行，但审批归属根会话；回放时看不出来源会很困惑 */}
        {record.sourceSessionId ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("来自子智能体「{{description}}」", {
              description: record.sourceDescription ?? record.sourceSessionId,
            })}
          </p>
        ) : null}
      </div>
      {footer ? (
        <MessageFooter item={footer.item} durationMs={footer.durationMs} onFork={onFork} />
      ) : null}
    </>
  );
}
