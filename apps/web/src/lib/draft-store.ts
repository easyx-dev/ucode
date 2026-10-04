/**
 * 输入区草稿附件的本地库（IndexedDB）：内容寻址（sha256 hex），只在本端，不随会话同步。
 *
 * 附件以 Blob 存原始字节，发送时读成 base64 随 prompt 上传；预览用缓存的 object URL。
 * 库名由品牌 slug 派生，换品牌后互不干扰。
 */
import { brand } from "@ucode/brand";

const DB_NAME = `${brand.slug}-drafts`;
const DB_VERSION = 1;
const STORE = "blobs";

/** 库内记录：内容 hash 为键，保留原始文件名用于展示 */
export type DraftBlobRecord = { id: string; name: string; blob: Blob };

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * 内容 id：sha256 十六进制小写，与服务端附件库同一套标识。
 * `crypto.subtle` 只在安全上下文（https / localhost）可用；局域网 http 下退化成随机 id，
 * 失去去重但不影响使用。
 */
const contentIdOf = async (blob: Blob): Promise<string> => {
  if (!crypto.subtle) return crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** 存入附件并返回内容 id；同一份内容天然去重 */
export const putDraftBlob = async (blob: Blob, name: string): Promise<string> => {
  const id = await contentIdOf(blob);
  const existing = await withStore<DraftBlobRecord | undefined>("readonly", (store) =>
    store.get(id),
  );
  if (!existing) {
    await withStore("readwrite", (store) =>
      store.put({ id, name, blob } satisfies DraftBlobRecord),
    );
  }
  return id;
};

/** 读回附件；不存在（被清理或换浏览器）返回 null */
export const getDraftBlob = async (id: string): Promise<DraftBlobRecord | null> => {
  const record = await withStore<DraftBlobRecord | undefined>("readonly", (store) => store.get(id));
  return record ?? null;
};

const urlCache = new Map<string, string>();

/** 预览用的 object URL；同一 id 复用，避免重复创建 */
export const previewUrlOf = (id: string, blob: Blob): string => {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
};

/** 释放某个预览 URL（附件被移除 / 超出上限丢弃时调用） */
export const releasePreviewUrl = (id: string): void => {
  const url = urlCache.get(id);
  if (!url) return;
  URL.revokeObjectURL(url);
  urlCache.delete(id);
};
