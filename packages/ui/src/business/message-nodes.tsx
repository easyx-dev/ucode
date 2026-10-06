/**
 * 消息节点渲染：把 `ChatItem[]` 投影成内容段与工具分组，分别交给 MessageItem 与 ToolCallGroup。
 * 子智能体的内联进度也走这里，嵌套复用同一套节点渲染。
 */
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildChatNodes } from "../lib/chat-nodes";
import type { ChatItem, SubagentStream, SubagentStreams } from "../lib/types";
import { MessageItem } from "./message-item";
import { ToolCallGroup } from "./tool-call-group";

type MessageNodesProps = {
  items: ChatItem[];
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents?: SubagentStreams;
  /** 从某条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话）；返回是否已受理 */
  onEdit?: (item: ChatItem, text: string) => Promise<boolean>;
  /** 打开子会话 */
  onOpenSession?: (sessionId: string) => void;
};

/** 子智能体的内联进度：子会话自身的消息，折叠在父会话的工具条目里 */
function SubagentProgress({
  stream,
  onOpenSession,
}: {
  stream: SubagentStream;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const status = stream.done ? (stream.isError ? t("失败") : t("完成")) : t("执行中");

  return (
    <div className="border-t border-border pt-2">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Bot className="size-3.5 shrink-0" />
        <span className="shrink-0">{t("子智能体过程")}</span>
        {stream.description ? (
          <span className="truncate text-foreground/70">{stream.description}</span>
        ) : null}
        <span className="ml-auto shrink-0">{status}</span>
        {onOpenSession && stream.sessionId ? (
          <button
            type="button"
            className="shrink-0 text-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onOpenSession(stream.sessionId)}
          >
            {t("打开子会话")}
          </button>
        ) : null}
      </div>
      <div className="space-y-3 border-l-2 border-border pl-3">
        {/* 子会话不能再派子智能体，嵌套视图不再下传 subagents / onFork / onEdit */}
        <MessageNodes items={stream.items} />
      </div>
    </div>
  );
}

export function MessageNodes({
  items,
  subagents,
  onFork,
  onEdit,
  onOpenSession,
}: MessageNodesProps) {
  const nodes = buildChatNodes(items);

  // 最后一条用户消息之后的编辑会移除后续内容，据此给出提示
  let lastUserId = "";
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.role === "user") {
      lastUserId = item.id;
      break;
    }
  }

  return (
    <>
      {nodes.map((node) =>
        node.kind === "tools" ? (
          <ToolCallGroup
            key={node.key}
            entries={node.entries}
            footer={node.footer}
            onFork={onFork}
            renderExtra={(entry) => {
              const stream = subagents?.[entry.id];
              return stream ? (
                <SubagentProgress stream={stream} onOpenSession={onOpenSession} />
              ) : null;
            }}
          />
        ) : (
          <MessageItem
            key={node.key}
            item={node.item}
            blocks={node.blocks}
            trailing={node.trailing}
            turnEnd={node.turnEnd}
            durationMs={node.durationMs}
            onFork={onFork}
            onEdit={onEdit}
            isLastUser={node.item.id === lastUserId}
          />
        ),
      )}
    </>
  );
}
