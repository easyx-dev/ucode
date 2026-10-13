/**
 * 消息区的一行：按扁平行模型分发到具体渲染器，并负责行首间距。
 *
 * 间距用 padding 而不是 margin —— 虚拟列表的默认测量取元素高度，margin 不计入，会让滚动位置算错。
 * 新一轮留白更大（`pt-6`），轮内各行用 `pt-3`，读者靠这个差值分辨轮次边界。
 */
import { cn } from "cn";
import type { ReactNode } from "react";
import type { ChatItem, EditMessagePayload } from "../../../types";
import { GoalDivider } from "../../goal/goal-divider";
import { GoalTurnLine } from "../../goal/goal-turn-line";
import { PermissionRecordView } from "../decision/permission-record";
import { QuestionForm } from "../decision/question-form";
import { ActivityGroup } from "../tool/activity-group";
import { WorkingIndicator } from "../tool/working-indicator";
import type { ToolEntry } from "./chat-nodes";
import type { ChatRow } from "./chat-rows";
import { CompactionDivider } from "./compaction-divider";
import { InjectedLine } from "./injected-line";
import { MessageItem } from "./message-item";
import { RetryLine } from "./retry-line";

/** 每行的上下文：由列表统一构造，避免逐行重建回调 */
export type MessageRowContext = {
  /** 工具行内的尾部入口（如子智能体的「查看进度」） */
  renderToolTrailing?: (entry: ToolEntry) => ReactNode;
  /** 正在压缩上下文：尾部的进行中提示据此换文案，且不报本轮耗时 */
  compacting?: boolean;
  /** 从该条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话） */
  onEdit?: (item: ChatItem, payload: EditMessagePayload) => Promise<boolean>;
  /** 从目录条跳过来后要闪一下的那一行 key（由列表在 1.6s 后收掉） */
  highlightKey?: string;
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
    body = <CompactionDivider summary={row.node.summary} record={row.node.record} />;
  } else if (row.kind === "injected") {
    body = (
      <InjectedLine
        customType={row.node.item.customType}
        prompt={row.node.item.goalPrompt}
        text={row.node.text}
      />
    );
  } else if (row.kind === "goal") {
    body = <GoalDivider record={row.node.record} />;
  } else if (row.kind === "goalTurn") {
    body = <GoalTurnLine turn={row.node.turn} />;
  } else if (row.kind === "retry") {
    body = <RetryLine record={row.node.record} />;
  } else if (row.kind === "content") {
    body = (
      <MessageItem
        item={row.node.item}
        blocks={row.node.blocks}
        trailing={row.node.trailing}
        footer={row.footer}
        highlight={row.key === context.highlightKey}
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
        renderTrailing={context.renderToolTrailing}
        onFork={context.onFork}
      />
    );
  }

  return <div className={cn(row.isTurnStart ? "pt-6" : "pt-3", "px-4")}>{body}</div>;
}
