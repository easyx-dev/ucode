/**
 * 输入区附件行的状态：粘贴 / 拖拽 → 预压缩 → 本地库（IndexedDB），
 * 发送时读成 base64；草稿里只存内容 id，回来时按 id 载回。
 */
import {
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  type MessageImage,
  PROMPT_MAX_IMAGES,
} from "@ucode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { getDraftBlob, previewUrlOf, putDraftBlob, releasePreviewUrl } from "@/lib/draft-store";
import { blobToBase64, compressImage } from "@/lib/image-encode";

export type ComposerAttachment = {
  /** 内容 id（sha256 hex），也是草稿里持久化的标识 */
  id: string;
  /** 原始文件名，用于预览与无障碍标签 */
  name: string;
  mimeType: ImageMimeType;
  /** 压缩后的字节数 */
  size: number;
  /** 本地预览 URL（object URL） */
  url: string;
};

/** 从 DataTransfer / FileList 取文件数组；粘贴与拖拽共用 */
export const filesOf = (transfer: DataTransfer | null): File[] =>
  transfer ? Array.from(transfer.files) : [];

const isImageMime = (value: string): value is ImageMimeType =>
  (IMAGE_MIME_TYPES as readonly string[]).includes(value);

type Options = {
  /** 草稿里恢复的附件 id */
  initialIds: readonly string[];
  /** 附件集合变化时回写草稿 */
  onChange: (ids: string[]) => void;
};

export function useComposerAttachments({ initialIds, onChange }: Options) {
  const [items, setItems] = useState<ComposerAttachment[]>([]);
  /** 被拒的文件名，供界面提示 */
  const [error, setError] = useState<string | null>(null);

  const itemsRef = useRef<ComposerAttachment[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apply = useCallback((next: ComposerAttachment[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  // 草稿恢复：按 id 从本地库载回。用拼接串作依赖，避免父级每次渲染新建数组
  const idsKey = initialIds.join("\n");
  useEffect(() => {
    let cancelled = false;
    const ids = idsKey.split("\n").filter(Boolean);
    void (async () => {
      const loaded: ComposerAttachment[] = [];
      for (const id of ids) {
        const record = await getDraftBlob(id);
        if (!record) continue;
        loaded.push({
          id,
          name: record.name,
          mimeType: isImageMime(record.blob.type) ? record.blob.type : "image/png",
          size: record.blob.size,
          url: previewUrlOf(id, record.blob),
        });
      }
      if (!cancelled) apply(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, idsKey]);

  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      const rejected: string[] = [];
      const added: ComposerAttachment[] = [];

      for (const file of files) {
        if (!isImageMime(file.type)) {
          rejected.push(file.name);
          continue;
        }
        try {
          const blob = await compressImage(file);
          const mimeType = isImageMime(blob.type) ? blob.type : "image/png";
          const id = await putDraftBlob(blob, file.name);
          added.push({
            id,
            name: file.name,
            mimeType,
            size: blob.size,
            url: previewUrlOf(id, blob),
          });
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
      // 超上限的多余附件直接丢弃（连同预览 URL）
      for (const item of merged.length > PROMPT_MAX_IMAGES
        ? merged.splice(PROMPT_MAX_IMAGES)
        : []) {
        releasePreviewUrl(item.id);
      }
      apply(merged);
      onChangeRef.current(merged.map((item) => item.id));
    },
    [apply],
  );

  const remove = useCallback(
    (id: string) => {
      const next = itemsRef.current.filter((item) => item.id !== id);
      releasePreviewUrl(id);
      apply(next);
      onChangeRef.current(next.map((item) => item.id));
    },
    [apply],
  );

  /** 读成发送用的图片载荷（base64）；读不到的条目跳过 */
  const toImages = useCallback(async (): Promise<MessageImage[]> => {
    const images: MessageImage[] = [];
    for (const item of itemsRef.current) {
      const record = await getDraftBlob(item.id);
      if (!record) continue;
      images.push({ data: await blobToBase64(record.blob), mimeType: item.mimeType });
    }
    return images;
  }, []);

  /** 当前附件 id，供草稿持久化与失败回填 */
  const ids = useCallback((): string[] => itemsRef.current.map((item) => item.id), []);

  return { items, error, addFiles, remove, toImages, ids };
}
