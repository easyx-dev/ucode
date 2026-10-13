/**
 * 附件的上传：文件一进来就在编辑器里插一个占位 chip，拿到 id 后按 `tempId` 就地补上。
 *
 * 草稿不另存附件视图——已上传的附件就在文档的节点里（消息发送时由 `docToPayload` 按顺序收）；
 * 上传中的占位节点没有 id，`docToPayload` 会跳过它，因此发送被 `hasPendingUploads` 挡在门外。
 * 草稿期上传的附件在服务端是「临时」状态（`referenced_at` 为空），随消息发送后转为永久，
 * 未被发送的由服务端按 TTL 回收，客户端不做删除。
 */
import {
  ATTACHMENT_MAX_UPLOAD_BYTES,
  type AttachmentView,
  PROMPT_MAX_ATTACHMENTS,
} from "@ucode/contracts";
import { type RefObject, useCallback, useRef, useState } from "react";

import { useClient } from "../../../provider";
import type { ComposerEditorHandle } from "./editor";

/** 从 DataTransfer / FileList 取文件数组；粘贴与拖拽共用 */
export const filesOf = (transfer: DataTransfer | null): File[] =>
  transfer ? Array.from(transfer.files) : [];

/** 上传中的占位 chip 需要的字段 */
type Placeholder = { tempId: string; name: string; kind: AttachmentView["kind"] };

type Options = {
  /** 编辑器句柄：占位、落定、丢弃都按 `tempId` 定位节点，不记会随编辑漂移的位置 */
  editor: RefObject<ComposerEditorHandle | null>;
};

export function useComposerAttachments({ editor }: Options) {
  const client = useClient();
  /** 被拒的文件名（超限、超量或上传失败），供界面提示 */
  const [error, setError] = useState<string | null>(null);
  /** 是否还有上传在途：期间禁用发送，避免附件没背上就发出去 */
  const [uploading, setUploading] = useState(false);

  const pendingRef = useRef(0);
  const tempRef = useRef(0);

  /** 上传是否在途；`submit` 用它做同步守卫，不依赖 React 状态的传播 */
  const hasPendingUploads = useCallback((): boolean => pendingRef.current > 0, []);

  const addFiles = useCallback(
    (files: File[]): void => {
      if (files.length === 0) return;
      const rejected: string[] = [];
      const accepted: File[] = [];
      // 已有节点（含上传中的占位）也算额度，超出的直接拒掉，不让它落进文档再回滚
      const room = PROMPT_MAX_ATTACHMENTS - (editor.current?.attachmentCount() ?? 0);

      for (const file of files) {
        if (file.size === 0 || file.size > ATTACHMENT_MAX_UPLOAD_BYTES) {
          rejected.push(file.name);
          continue;
        }
        if (accepted.length >= room) {
          rejected.push(file.name);
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length === 0) {
        setError(rejected.length > 0 ? rejected.join("、") : null);
        return;
      }

      const placeholders: Placeholder[] = accepted.map((file) => {
        tempRef.current += 1;
        return {
          tempId: `upload-${tempRef.current}`,
          name: file.name,
          kind: file.type.startsWith("image/") ? "image" : "file",
        };
      });
      editor.current?.insertAttachments(placeholders);

      pendingRef.current += accepted.length;
      setUploading(true);
      void Promise.all(
        accepted.map(async (file, index) => {
          const tempId = placeholders[index]?.tempId ?? "";
          try {
            const uploaded = await client.apis.attachments.upload(file, file.name);
            editor.current?.resolveAttachment(tempId, uploaded);
          } catch {
            rejected.push(file.name);
            editor.current?.dropAttachment(tempId);
          } finally {
            pendingRef.current -= 1;
            if (pendingRef.current === 0) setUploading(false);
          }
        }),
      ).then(() => {
        setError(rejected.length > 0 ? rejected.join("、") : null);
      });
    },
    [client, editor],
  );

  return { error, uploading, hasPendingUploads, addFiles };
}
