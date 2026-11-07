/** 远程访问面板状态：监听地址、活动会话、配对链接与改密码 */
import type { AuthSessionView, PairingCreateOutput, ServiceInfoResponse } from "@ucode/contracts";
import { type ApiError, asApiError } from "@ucode/sdk";
import { useCallback, useEffect, useState } from "react";

import { useClient } from "../../../provider";

export type RemoteAccess = {
  info: ServiceInfoResponse | null;
  sessions: AuthSessionView[];
  pairing: PairingCreateOutput | null;
  error: ApiError | null;
  busy: boolean;
  refresh: () => Promise<void>;
  setHost: (host: "127.0.0.1" | "0.0.0.0") => Promise<void>;
  createPairing: () => Promise<void>;
  revoke: (id: string) => Promise<void>;
};

export function useRemoteAccess(): RemoteAccess {
  const client = useClient();
  const [info, setInfo] = useState<ServiceInfoResponse | null>(null);
  const [sessions, setSessions] = useState<AuthSessionView[]>([]);
  const [pairing, setPairing] = useState<PairingCreateOutput | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await run(async () => {
      const [nextInfo, nextSessions] = await Promise.all([
        client.apis.service.info(),
        client.auth.listSessions(),
      ]);
      setInfo(nextInfo);
      setSessions(nextSessions);
    });
  }, [client, run]);

  // 面板挂载即取一次；弹窗关掉面板随之卸载，取数与二维码倒计时一并停止
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    info,
    sessions,
    pairing,
    error,
    busy,
    refresh,
    setHost: (host) =>
      run(async () => {
        setInfo(await client.apis.service.setHost(host));
      }),
    createPairing: () =>
      run(async () => {
        setPairing(await client.auth.createPairing());
      }),
    revoke: (id) =>
      run(async () => {
        await client.auth.revokeSession(id);
        setSessions(await client.auth.listSessions());
      }),
  };
}
