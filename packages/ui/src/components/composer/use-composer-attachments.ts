/**
 * 输入区附件行的状态：贴图 / 拖拽即上传到服务端，草稿只保存附件视图。
 *
 * 草稿期上传的附件在服务端是「临时」状态（`referenced_at` 为空），随消息发送后转为永久；
 * 未被发送的由服务端按 TTL 回收，客户端不做删除。
 */
import {
  ATTACHMENT_MAX_UPLOAD_BYTES,
  type AttachmentView,
  PROMPT_MAX_ATTACHMENTS,
} from "@ucode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api";

/** 从 DataTransfer / FileList 取文件数组；粘贴与拖拽共用 */
export const filesOf = (transfer: DataTransfer | null): File[] =>
  transfer ? Array.from(transfer.files) : [];

type Options = {
  /** 草稿里恢复的附件视图 */
  initialAttachments: readonly AttachmentView[];
  /** 附件集合变化时回写草稿 */
  onChange: (attachments: AttachmentView[]) => void;
};

export function useComposerAttachments({ initialAttachments, onChange }: Options) {
  const [items, setItems] = useState<AttachmentView[]>([]);
  /** 被拒的文件名（超限或上传失败），供界面提示 */
  const [error, setError] = useState<string | null>(null);
  /** 是否还有上传在途：期间禁用发送，避免附件没背上就发出去 */
  const [uploading, setUploading] = useState(false);

  const itemsRef = useRef<AttachmentView[]>([]);
  const pendingRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // 草稿视图只在 id 集合变化时同步，避免父级每次渲染新建数组触发重置
  const initialRef = useRef(initialAttachments);
  initialRef.current = initialAttachments;
  const idsKey = initialAttachments.map((attachment) => attachment.id).join("\n");

  const apply = useCallback((next: AttachmentView[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  useEffect(() => {
    apply(initialRef.current.slice(0, PROMPT_MAX_ATTACHMENTS));
  }, [apply, idsKey]);

  /** 上传是否在途；`submit` 用它做同步守卫，不依赖 React 状态的传播 */
  const hasPendingUploads = useCallback((): boolean => pendingRef.current > 0, []);

  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      pendingRef.current += 1;
      setUploading(true);
      try {
        const rejected: string[] = [];
        const added: AttachmentView[] = [];

        for (const file of files) {
          if (file.size === 0 || file.size > ATTACHMENT_MAX_UPLOAD_BYTES) {
            rejected.push(file.name);
            continue;
          }
          try {
            added.push(await api.attachments.upload(file, file.name));
          } catch {
            rejected.push(file.name);
          }
        }

        setError(rejected.length > 0 ? rejected.join("、") : null);
        if (added.length === 0) return;

        const merged = [...itemsRef.current];
        for (const item of added) {
          if (!merged.some((existing) => existing.id === item.id)) merged.push(item);
        }
        merged.splice(PROMPT_MAX_ATTACHMENTS);
        apply(merged);
        onChangeRef.current(merged);
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) setUploading(false);
      }
    },
    [apply],
  );

  const remove = useCallback(
    (id: string) => {
      const next = itemsRef.current.filter((item) => item.id !== id);
      apply(next);
      onChangeRef.current(next);
    },
    [apply],
  );

  return { items, error, uploading, hasPendingUploads, addFiles, remove };
}
