/**
 * 消息区的一行：按扁平行模型分发到具体渲染器，并负责行首间距。
 *
 * 间距用 padding 而不是 margin —— 虚拟列表的默认测量取元素高度，margin 不计入，会让滚动位置算错。
 * 新一轮留白更大（`pt-6`），轮内各行用 `pt-3`，读者靠这个差值分辨轮次边界。
 */
import { cn } from "cn";
import type { ReactNode } from "react";
import type { ToolEntry } from "../lib/chat-nodes";
import type { ChatRow } from "../lib/chat-rows";
import type { ChatItem } from "../lib/types";
import { ActivityGroup } from "./activity-group";
import { CompactionDivider } from "./compaction-divider";
import { MessageItem } from "./message-item";
import { PermissionRecordView } from "./permission-record";
import { QuestionForm } from "./question-form";
import { WorkingIndicator } from "./working-indicator";

/** 每行的上下文：由列表统一构造，避免逐行重建回调 */
export type MessageRowContext = {
  /** 工具条目追加的内容（如子智能体内联进度） */
  renderExtra?: (entry: ToolEntry) => ReactNode;
  /** 正在压缩上下文：尾部的进行中提示据此换文案，且不报本轮耗时 */
  compacting?: boolean;
  /** 从该条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话） */
  onEdit?: (item: ChatItem, text: string) => Promise<boolean>;
};

export function MessageRow({ row, context }: { row: ChatRow; context: MessageRowContext }) {
  let body: ReactNode;

  if (row.kind === "working") {
    body = <WorkingIndicator startedAt={row.startedAt} compacting={context.compacting} />;
  } else if (row.kind === "question") {
    body = (
      <QuestionForm
        questions={row.node.questions}
        answers={row.node.answers}
        settled={row.node.settled}
        footer={row.footer}
        onFork={context.onFork}
      />
    );
  } else if (row.kind === "permission") {
    body = (
      <PermissionRecordView record={row.node.record} footer={row.footer} onFork={context.onFork} />
    );
  } else if (row.kind === "compaction") {
    body = <CompactionDivider summary={row.node.summary} />;
  } else if (row.kind === "content") {
    body = (
      <MessageItem
        item={row.node.item}
        blocks={row.node.blocks}
        trailing={row.node.trailing}
        footer={row.footer}
        onFork={context.onFork}
        onEdit={context.onEdit}
        isLastUser={row.isLastUser}
      />
    );
  } else {
    body = (
      <ActivityGroup
        legs={row.node.legs}
        footer={row.footer}
        active={row.active}
        renderExtra={context.renderExtra}
        onFork={context.onFork}
      />
    );
  }

  return <div className={cn(row.isTurnStart ? "pt-6" : "pt-3", "px-4")}>{body}</div>;
}
