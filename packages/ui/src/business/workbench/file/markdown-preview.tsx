/**
 * Markdown 预览：读文档而不是读源码，正文走与对话区同一条渲染链，只有 fenced code 才进 shiki。
 */
import { MessageResponse } from "../../markdown/message-response";

export function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="px-4 py-3">
      <div className="md-content">
        <MessageResponse text={text} />
      </div>
    </div>
  );
}
