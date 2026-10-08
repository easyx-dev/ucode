/**
 * 非用户消息的内容渲染：assistant 内容段（正文 / 思考 / 图片 / 附件）、扩展条目与已忽略的计划。
 *
 * 工具调用与思考区块已由 chat-nodes 抽成 activity 聚合行，压缩摘要另有分隔行（compaction-divider），
 * 这里只渲染正文 / 图片 / 附件；`trailing` 表示该段是否是来源消息的最后一段。
 * 用户消息自成一体（含 chip、折叠与操作行），见 `user-message.tsx`。
 */
import { useTranslation } from "react-i18next";
import type { ChatFooter } from "../lib/chat-nodes";
import { isPlanIgnored } from "../lib/plan";
import type { ChatItem, EditMessagePayload, MessageBlock } from "../lib/types";
import { BlockView } from "./message-blocks";
import { MessageFooter } from "./message-footer";
import { UserMessage } from "./user-message";

export function MessageItem({
  item,
  blocks,
  trailing = true,
  footer,
  onFork,
  onEdit,
  isLastUser,
}: {
  item: ChatItem;
  /** 覆盖渲染的内容块（assistant 被拆成多段时只渲染其中一段）；缺省渲染整条消息 */
  blocks?: MessageBlock[];
  /** 是否为来源消息的最后一段；流式光标只挂在最后一段上 */
  trailing?: boolean;
  /** 该轮页脚（模型 / 耗时与分叉入口）；只落在轮末那一行上，缺省不渲染 */
  footer?: ChatFooter;
  /** 从该条消息分叉；只有主对话传入，子智能体嵌套视图不提供 */
  onFork?: (item: ChatItem) => void;
  /** 编辑该条用户消息并重发；引用与附件一并回传，成功后由事件刷新，返回是否已受理 */
  onEdit?: (item: ChatItem, payload: EditMessagePayload) => Promise<boolean>;
  /** 是否为本会话最后一条用户消息；非最后一条会提示其后内容将被移除 */
  isLastUser?: boolean;
}) {
  const { t } = useTranslation();
  const content = blocks ?? item.blocks;

  if (item.role === "user") {
    return (
      <UserMessage
        item={item}
        blocks={content}
        onFork={onFork}
        onEdit={onEdit}
        isLastUser={isLastUser}
      />
    );
  }

  // 忽略计划的界面标记：沿用 muted 便签，不带「（扩展消息）」前缀
  if (isPlanIgnored(item)) {
    return (
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/10">
        {t("已忽略计划")}
      </div>
    );
  }

  // 扩展条目（custom）不展开内容：它只是界面标记，真正要回放的信息由各标记自己渲染
  if (item.role === "custom") {
    const text = content.map((block) => (block.type === "text" ? block.text : "")).join("");
    return (
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/10">
        {t("（扩展消息）")} {text.slice(0, 400)}
      </div>
    );
  }

  return (
    <div className="group min-w-0 flex-1 space-y-2">
      {content.map((block, index) => (
        <BlockView
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks 是按顺序追加的内容块，没有自然 id，位置即身份
          key={`${item.id}-${index}`}
          block={block}
          live={item.live && trailing && index === content.length - 1}
        />
      ))}
      {footer ? (
        <MessageFooter item={footer.item} durationMs={footer.durationMs} onFork={onFork} />
      ) : null}
    </div>
  );
}
