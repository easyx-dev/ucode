/**
 * harness 内的公共小方法：把 pi 的消息内容拼成文本。
 *
 * 会话预览（`pi/session-index`）、转录（`features/transcript`）与子会话产出（`features/subagents`）
 * 都按同一口径取正文，原先三处各写了一版这个判定，这里收敛成一份。
 */
import { isRecord } from "../../utils/object";

/**
 * 消息内容 → 一段文本：字符串原样，内容块数组只认 `TextContent`（`type: "text"` 且有 `text`）。
 * 图片、思考与工具调用块没有可读正文，一律跳过；空片段也跳过（流式过程中可能是空串）。
 * 分隔符按用途给：预览拼一行用空格，转录用换行。
 */
export const textOfContent = (content: unknown, separator = " "): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .filter((text) => text.length > 0)
    .join(separator);
};
