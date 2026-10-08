/**
 * 用户消息的编辑重发：复用输入区的编辑器改写正文（引用与附件都还原成节点），提交时换算回载荷。
 *
 * 与输入区的差别只有两处：命令节点只读（`/` 菜单停用，不能再造一个内置动作），
 * 发送键沿用输入区的 Enter（Shift+Enter 换行）——两处输入体验本来就该一致。
 */
import type { EditMessagePayload } from "@ucode/sdk";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { type ComposerNode, docToPayload } from "../lib/composer-document";
import { isPayloadEmpty } from "../lib/composer-payload";
import { type ParsedUserMessage, relativizeContextRefs } from "../lib/message-chips";
import { messageTextToDoc } from "../lib/message-document";
import type { ChatItem } from "../lib/types";
import { useWorkbench } from "../provider/workbench";
import { useContextItems } from "./composer/context-items";
import { ComposerEditor, type ComposerEditorHandle } from "./composer/editor";
import { useComposerAttachments } from "./composer/use-composer-attachments";

type FormProps = {
  item: ChatItem;
  parsed: ParsedUserMessage;
  images: readonly string[];
  onEdit: (item: ChatItem, payload: EditMessagePayload) => Promise<boolean>;
  onCancel: () => void;
};

/**
 * 编辑态的状态与投递：编辑器文档、`@` 候选、附件上传与提交。
 * 文档是载荷的唯一来源——引用与附件的位置、顺序都在里面（「文档 → 载荷」只有一条路径）。
 */
const useEditComposer = ({ item, parsed, images, onEdit, onCancel }: FormProps) => {
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const docRef = useRef<ComposerNode>(messageTextToDoc(parsed, images));
  const { error, uploading, hasPendingUploads, addFiles } = useComposerAttachments({
    editor: editorRef,
  });
  // 没有工作台（子会话嵌套视图、测试）时 `@` 检索不可用，菜单在调用方停用
  const cwd = useWorkbench()?.cwd ?? null;
  const contextItems = useContextItems(cwd);

  const submit = useCallback(() => {
    // 附件还在上传时不发：没拿到 id 的占位节点会被 `docToPayload` 跳过
    if (saving || hasPendingUploads()) return;
    const payload = docToPayload(docRef.current);
    if (isPayloadEmpty(payload)) return;
    setSaving(true);
    // 与首次发送同一条口径：正文里的引用标记换算成工作目录相对写法（展开块上的 `path` 也是它），
    // 否则回放时正文里的标记与展开块对不上，引用 chip 就认不出来了
    void onEdit(item, relativizeContextRefs(payload, cwd ?? undefined)).then((accepted) => {
      setSaving(false);
      if (accepted) onCancel();
    });
  }, [cwd, hasPendingUploads, item, onCancel, onEdit, saving]);

  const onChange = useCallback((doc: ComposerNode) => {
    docRef.current = doc;
  }, []);

  return {
    editorRef,
    docRef,
    contextItems,
    cwd,
    error,
    uploading,
    saving,
    addFiles,
    submit,
    onChange,
  };
};

export function MessageEditForm({
  item,
  parsed,
  images,
  warning,
  onEdit,
  onCancel,
}: FormProps & { warning: boolean }) {
  const { t } = useTranslation();
  const form = useEditComposer({ item, parsed, images, onEdit, onCancel });

  return (
    <div className="flex justify-end">
      <div className="w-full max-w-[85%] space-y-1.5">
        <div className="rounded-xl bg-popover ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-ring/40">
          <ComposerEditor
            ref={form.editorRef}
            initialDoc={form.docRef.current}
            placeholder={t("改写这条消息，Enter 发送，Shift+Enter 换行")}
            onChange={form.onChange}
            onSend={form.submit}
            {...(form.cwd ? { contextItems: form.contextItems } : {})}
            onEscape={onCancel}
            onFiles={form.addFiles}
          />
        </div>

        {form.error ? (
          <p className="text-xs text-destructive">
            {t("无法添加附件：{{names}}", { names: form.error })}
          </p>
        ) : null}
        {warning ? (
          <p className="text-[11px] text-muted-foreground">
            {t("发送后将移除这条消息之后的内容（仍保留在会话记录中）。")}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("取消")}
          </Button>
          <Button size="sm" disabled={form.saving || form.uploading} onClick={form.submit}>
            {t("发送")}
          </Button>
        </div>
      </div>
    </div>
  );
}
