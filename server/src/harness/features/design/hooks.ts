/**
 * 内核与装配层需要的那部分设计能力：只有类型，不含实现。
 *
 * 放在单独的文件里是为了让 `core`（会话池）与 `harness/setup`（装配）都能引用它而不互相依赖：
 * 池只注入，装配只消费，实现在 `index.ts`（同 `features/browser/hooks.ts` 的分工）。
 */
import type { DesignToolHooks } from "./types";

export type DesignHooks = {
  /** 工具入口：一个会话一份，闭包着会话身份与工作目录 */
  toolHooks: (input: { sessionId: string; cwd: string }) => DesignToolHooks;
  /** 会话离池：没人再看那份文件时落盘回收（**指针留着**，画布还开着） */
  release: (sessionId: string) => void;
  /** 会话归档 / 删除：指针与缓存一起丢 */
  forget: (sessionId: string) => void;
};
