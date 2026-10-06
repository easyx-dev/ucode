/**
 * 「显示思考过程」的本地偏好。
 *
 * 消息列表与设置面板分处两棵子树，故用一个模块级 store 广播变更（各窗口 / 各端各自一份，互不影响）；
 * 这是纯界面偏好，只落 localStorage，不进服务端 `config.json`。
 */
import { brand } from "@ucode/brand";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = `${brand.slug}-show-thinking`;

/** 读不到（隐私模式）时按展示处理：思考过程默认可见 */
const read = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
};

let showThinking = read();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): boolean => showThinking;

const write = (next: boolean): void => {
  showThinking = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // 写不进去（隐私模式）不影响本次会话
  }
  for (const listener of listeners) listener();
};

export function useShowThinking(): {
  showThinking: boolean;
  setShowThinking: (next: boolean) => void;
} {
  return {
    showThinking: useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    setShowThinking: write,
  };
}
