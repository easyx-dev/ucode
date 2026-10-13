/**
 * 统一错误提示：订阅各 SDK store 的 error 字段与服务端错误帧，出现新错误时弹一次 toast。
 *
 * store 动作不再各自弹提示；表单类操作的成功反馈仍由对应 hooks 负责。
 */
import { type ApiError, describeError, type Translate } from "@ucode/sdk";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useClient } from "../../provider";

type ErrorSource = {
  getState: () => { error: ApiError | null };
  subscribe: (listener: () => void) => () => void;
};

export function ErrorToaster() {
  const client = useClient();
  const { t } = useTranslation();
  const translate = t as unknown as Translate;
  const last = useRef(new Map<string, ApiError | null>());

  useEffect(() => {
    const sources: Array<[string, ErrorSource]> = [
      ["sessions", client.sessions],
      ["interactions", client.interactions],
      ["models", client.models],
      ["config", client.config],
      ["mcp", client.mcp],
      ["projects", client.projects],
      ["usage", client.usage],
      ["goal", client.goal],
    ];

    const check = (name: string, error: ApiError | null): void => {
      if (!error) {
        last.current.delete(name);
        return;
      }
      if (last.current.get(name) === error) return;
      last.current.set(name, error);
      toast.error(describeError(error, translate));
    };

    const unsubscribers = sources.map(([name, store]) =>
      store.subscribe(() => check(name, store.getState().error)),
    );
    for (const [name, store] of sources) check(name, store.getState().error);
    // 服务端在请求之外推送的错误（后台生成失败等）也提示一次
    const offError = client.events.onError((error) => toast.error(describeError(error, translate)));

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      offError();
    };
  }, [client, translate]);

  return null;
}
