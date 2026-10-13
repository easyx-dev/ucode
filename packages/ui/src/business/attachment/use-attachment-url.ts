/**
 * 附件字节 → object URL。
 *
 * 凭证只在 `Authorization` 头里，而浏览器不会给 `<img src>` / `<a href>` 带自定义头，
 * 所以组件得自己把字节取回来。同一附件在所有使用者之间共享一份 URL 与同一个在途请求，
 * 最后一个使用者卸载后才释放；认不出是附件的来源（外链、data URL）原样返回。
 */
import { API_BASE_PATH } from "@ucode/contracts";
import { useEffect, useState } from "react";

import { useClient } from "../../provider";

const ATTACHMENT_PREFIX = `${API_BASE_PATH}/attachments/`;
const ATTACHMENT_ID = /^[0-9a-f]{64}$/;

/** 附件路由地址或裸 id 都能认出；其余返回 null */
const attachmentIdOf = (source: string): string | null => {
  const raw = source.startsWith(ATTACHMENT_PREFIX)
    ? source.slice(ATTACHMENT_PREFIX.length)
    : source;
  return ATTACHMENT_ID.test(raw) ? raw : null;
};

export type AttachmentUrlState = {
  /** 可直接用作 `src` / `href`：附件是 blob URL，非附件来源原样返回；未就绪为 null */
  url: string | null;
  /** 字节取不回来（会话失效 / 字节已不在）：调用方给占位，别让内容凭空消失 */
  failed: boolean;
};

type Entry = {
  url: string | null;
  failed: boolean;
  /** 在途请求；多处同时用到同一附件时复用，避免重复下载，也避免各自建 URL 互相覆盖 */
  pending: Promise<void> | null;
  refs: number;
};

const entries = new Map<string, Entry>();

/** 最后一个使用者卸载后回收；下载还在飞时等它结束，免得紧接着的再次挂载又发一遍请求 */
const release = (id: string, entry: Entry): void => {
  const drop = (): void => {
    if (entry.refs > 0 || entries.get(id) !== entry) return;
    entries.delete(id);
    if (entry.url) URL.revokeObjectURL(entry.url);
  };
  if (entry.pending) {
    void entry.pending.then(drop);
    return;
  }
  drop();
};

export function useAttachmentUrl(source: string): AttachmentUrlState {
  const client = useClient();
  const id = attachmentIdOf(source);
  const [state, setState] = useState<AttachmentUrlState>({ url: null, failed: false });

  useEffect(() => {
    if (!id) return undefined;

    const entry = entries.get(id) ?? { url: null, failed: false, pending: null, refs: 0 };
    entries.set(id, entry);
    entry.refs += 1;
    setState((prev) =>
      prev.url === entry.url && prev.failed === entry.failed
        ? prev
        : { url: entry.url, failed: entry.failed },
    );

    entry.pending ??= client.apis.attachments
      .download(id)
      .then((blob) => {
        // 期间没人再用（缓存项已清）就不再建 URL，免得留下没人释放的 handle
        if (entries.get(id) !== entry) return;
        entry.url = URL.createObjectURL(blob);
      })
      .catch(() => {
        entry.failed = true;
      });

    let active = true;
    void entry.pending.then(() => {
      if (!active) return;
      setState((prev) =>
        prev.url === entry.url && prev.failed === entry.failed
          ? prev
          : { url: entry.url, failed: entry.failed },
      );
    });

    return () => {
      active = false;
      entry.refs -= 1;
      if (entry.refs === 0) release(id, entry);
    };
  }, [client, id]);

  return id ? state : { url: source, failed: false };
}
