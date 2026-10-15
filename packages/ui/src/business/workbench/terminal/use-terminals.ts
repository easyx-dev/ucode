/**
 * 终端的列表状态：按当前工作目录向服务端要一份，创建 / 结束之后本地跟着改。
 *
 * 服务端是唯一事实源（终端活在服务进程里），客户端只在挂载与换目录时拉一次：
 * 别端开的终端要等下一次拉取才会出现——这是刻意的简化，不做跨端实时同步。
 * 进程的存亡与标签无关：工作目录变了标签会清空，进程仍在列表里，点开即可重新挂上。
 */
import type { TerminalInfo } from "@ucode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClient } from "../../../provider";

/** 新建时的初始尺寸；面板挂载后按实测值再改一次（服务端先按它起 PTY） */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export type Terminals = {
  items: readonly TerminalInfo[];
  /** 重新拉一份（挂载、换目录、手动刷新） */
  reload: () => void;
  /** 起一个终端；失败时抛，由调用方提示 */
  create: (cwd: string) => Promise<TerminalInfo>;
  /** 结束终端（杀进程）；本地列表立即摘除条目 */
  close: (id: string) => Promise<void>;
};

export function useTerminals(cwd: string | null): Terminals {
  const client = useClient();
  const [items, setItems] = useState<readonly TerminalInfo[]>([]);
  /** 最近一次的目标目录：响应回来时用它挡掉「换目录前的旧请求」 */
  const activeCwd = useRef<string | null>(cwd);

  const reload = useCallback(() => {
    const target = cwd;
    if (!target) {
      setItems([]);
      return;
    }
    void client.apis.terminal
      .list({ cwd: target })
      .then((result) => {
        if (activeCwd.current === target) setItems(result.terminals);
      })
      .catch(() => {
        // 列不出来（目录刚被删、服务刚重启）时按空处理，不打断面板
        if (activeCwd.current === target) setItems([]);
      });
  }, [client, cwd]);

  useEffect(() => {
    activeCwd.current = cwd;
    setItems([]);
    reload();
  }, [cwd, reload]);

  const create = useCallback(
    async (targetCwd: string): Promise<TerminalInfo> => {
      const info = await client.apis.terminal.create({
        cwd: targetCwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });
      setItems((prev) => (prev.some((item) => item.id === info.id) ? prev : [...prev, info]));
      return info;
    },
    [client],
  );

  const close = useCallback(
    async (id: string): Promise<void> => {
      setItems((prev) => prev.filter((item) => item.id !== id));
      // 已经结束的终端再关一次只有 false，不是错误
      await client.apis.terminal.close({ terminalId: id }).catch(() => {});
    },
    [client],
  );

  return { items, reload, create, close };
}
