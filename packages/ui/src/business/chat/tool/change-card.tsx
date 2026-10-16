/**
 * 写盘类工具（`edit` / `write`）的改动卡片：独立成段，收起时是一行「标题 + 路径」，展开是行级 diff。
 *
 * 为什么不并进聚合行：聚合把改动折进一句「使用了 2 个 编辑」，用户事后回看时看不到到底改了哪几行，
 * 而「改了什么」正是最常回看的内容。外观取提问段 / 审批段那一套（`bg-muted/40` + 描边），
 * 一眼能认出「这里改过东西」；卡片里仍是同一个工具卡（头部 + 展开体），不另做一套渲染。
 *
 * `write` 保持中性标题（「写入」）：pi 的 write 是 create-or-overwrite，从入参区分不出新建与覆盖。
 */
import type { ChatItem } from "../../../types";
import type { ChatFooter, ToolEntry } from "../message/chat-nodes";
import { MessageFooter } from "../message/message-footer";
import { ToolCall } from "./tool-call";

type ChangeCardProps = {
  entry: ToolEntry;
  /** 本轮以此收尾时的页脚 */
  footer?: ChatFooter;
  /** 从该条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
};

export function ChangeCard({ entry, footer, onFork }: ChangeCardProps) {
  return (
    <>
      <div className="rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-border-strong">
        <ToolCall entry={entry} />
      </div>
      {footer ? (
        <MessageFooter item={footer.item} durationMs={footer.durationMs} onFork={onFork} />
      ) : null}
    </>
  );
}
