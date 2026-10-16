/**
 * 表格单元格的自动换行开关。
 *
 * 同一屏里的所有表格共用一份状态：换行是全局偏好而不是每张表自己的事，一张表切换后
 * 另一张的单元格与开关按钮要立刻跟上（同一条消息里两张表、或两条都看得见的消息各一张表）。
 */
import { useSyncExternalStore } from "react";

import { readTableWrap, writeTableWrap } from "./table-prefs";

export type TableWrap = {
  wrap: boolean;
  toggleWrap: () => void;
};

let wrap = readTableWrap();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): boolean => wrap;

/** 副作用（写 localStorage 与广播）不当成 setState 的 updater：updater 必须是纯函数 */
const setWrap = (next: boolean): void => {
  if (next === wrap) return;
  wrap = next;
  writeTableWrap(next);
  for (const listener of listeners) listener();
};

export function useTableWrap(): TableWrap {
  return {
    wrap: useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    // 读模块变量而不是本轮的 `wrap`：连点两次时第二次也该按第一次的结果取反
    toggleWrap: () => setWrap(!wrap),
  };
}
