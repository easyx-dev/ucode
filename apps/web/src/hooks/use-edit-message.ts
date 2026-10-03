/** 编辑用户消息并重发：调用接口后由服务端的 transcript_reset 事件统一刷新，不在这里重取快照 */
import { useCallback } from "react";

import { api, describeError } from "@/lib/api";

type EditMessageOptions = {
  sessionId: string | null;
  onError: (message: string | null) => void;
};

export function useEditMessage({ sessionId, onError }: EditMessageOptions) {
  const edit = useCallback(
    async (entryId: string, text: string): Promise<boolean> => {
      if (!sessionId) return false;
      onError(null);
      try {
        await api.messages.edit({ sessionId, entryId, text });
        return true;
      } catch (error) {
        onError(describeError(error));
        return false;
      }
    },
    [onError, sessionId],
  );

  return { edit };
}
