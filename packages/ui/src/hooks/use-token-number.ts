/**
 * 读取数值型 token 的当前值（像素）。
 *
 * 第三方组件只接受数字字号（diff 视图的 `diffViewFontSize`），没法直接吃 CSS 变量；
 * 而 `getPropertyValue("--text-xs")` 拿到的是未求值的 `calc(14px * 6 / 7)`，
 * 所以这里只读**可解析的基准**（`--font-size-base` 这类写入 px 字面量的参数），
 * 档位系数由调用处乘。
 *
 * 外观参数写在 `<html>` 的行内样式上，用 MutationObserver 跟随字号与密度变化。
 * 同一 token 的调用方共用**一个** observer（引用计数归零即释放）：diff 的「全部改动」堆叠视图
 * 会一次挂出几十个调用方，各挂一个 observer 是没必要的开销。
 */
import { useEffect, useState } from "react";

type Entry = { observer: MutationObserver; listeners: Set<() => void> };

/** 观察器池：只托管 DOM 订阅，不持有业务状态；无订阅者时整条记录删掉 */
const pool = new Map<string, Entry>();

const subscribe = (token: string, listener: () => void): (() => void) => {
  let entry = pool.get(token);
  if (!entry) {
    const listeners = new Set<() => void>();
    const observer = new MutationObserver(() => {
      for (const notify of listeners) notify();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme", "class"],
    });
    entry = { observer, listeners };
    pool.set(token, entry);
  }
  entry.listeners.add(listener);
  return () => {
    const current = pool.get(token);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.observer.disconnect();
      pool.delete(token);
    }
  };
};

const read = (token: string): number => {
  // 没有 DOM（测试、预渲染）时保持调用方给的兜底值
  if (typeof document === "undefined") return Number.NaN;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return Number.parseFloat(raw);
};

export function useTokenNumber(token: string, fallback: number): number {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const sync = (): void => {
      const next = read(token);
      if (Number.isFinite(next) && next > 0) setValue(next);
    };
    // 挂载时先对齐一次：参数可能在本次渲染之前就被写进根节点
    sync();
    return subscribe(token, sync);
  }, [token]);

  return value;
}
