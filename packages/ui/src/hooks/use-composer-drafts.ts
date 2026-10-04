/** 输入区草稿的读写：按上下文合并、落盘，见 `lib/composer-draft` */
import { useCallback, useRef, useState } from "react";

import {
  type ComposerDraft,
  emptyDraft,
  readComposerDrafts,
  writeComposerDrafts,
} from "../lib/composer-draft";

export type ComposerDraftsController = {
  /** 全部草稿，按上下文键索引；读取方用 `emptyDraft()` 兜底 */
  drafts: Record<string, ComposerDraft>;
  /** 合并写入某个上下文的草稿并落盘 */
  update: (key: string, patch: Partial<ComposerDraft>) => void;
  /** 清掉某个上下文的草稿（发送成功 / 会话归档） */
  clear: (key: string) => void;
};

export function useComposerDrafts(): ComposerDraftsController {
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>(readComposerDrafts);
  /** 最新值的同步副本：写盘放在 setState 之外（updater 必须是纯函数） */
  const draftsRef = useRef(drafts);

  const commit = useCallback((next: Record<string, ComposerDraft>) => {
    draftsRef.current = next;
    writeComposerDrafts(next);
    setDrafts(next);
  }, []);

  const update = useCallback(
    (key: string, patch: Partial<ComposerDraft>) => {
      const prev = draftsRef.current;
      commit({ ...prev, [key]: { ...(prev[key] ?? emptyDraft()), ...patch } });
    },
    [commit],
  );

  const clear = useCallback(
    (key: string) => {
      if (!(key in draftsRef.current)) return;
      const { [key]: _dropped, ...next } = draftsRef.current;
      commit(next);
    },
    [commit],
  );

  return { drafts, update, clear };
}
