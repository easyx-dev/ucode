/**
 * Mermaid 渲染：图源 → SVG，带三态结果。
 *
 * mermaid 的 `initialize` 是全局状态、`render` 内部是同步布局，多张图并发渲染既会互相踩配置也会卡住
 * 主线程，所以全页共用一个队列，一次只渲染一张。渲染失败（流式未闭合、语法不在支持范围）不是异常
 * 状态，交给调用方回落成源码。
 */
import type { DiagramPlugin } from "@streamdown/mermaid";
import { brand } from "@ucode/brand/values";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";
import { createMermaidConfig } from "./mermaid-config";

export type MermaidRenderState =
  /** 正在渲染 */
  | { status: "rendering" }
  /** 渲染完成 */
  | { status: "ready"; svg: string }
  /** 不渲染或渲染失败，调用方展示源码 */
  | { status: "fallback" };

/** mermaid 整体按需加载：文档里没有图就不下载任何 mermaid 代码 */
let plugin: Promise<DiagramPlugin> | null = null;

/** 串行队列：把「加载 + 渲染」串成一串，避免并发 initialize */
let queue: Promise<unknown> = Promise.resolve();

const renderInQueue = (
  isDark: boolean,
  renderId: string,
  source: string,
): Promise<{ svg: string }> => {
  const run = async (): Promise<{ svg: string }> => {
    plugin ??= import("@streamdown/mermaid").then(({ createMermaidPlugin }) =>
      createMermaidPlugin(),
    );
    const mermaid = (await plugin).getMermaid(createMermaidConfig(isDark));
    return mermaid.render(renderId, source);
  };
  // 前一个任务成败都接着跑：链条不能因为一张图画不出来就断掉
  const task = queue.then(run, run);
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

/** FNV-1a：图源当渲染 id 与缓存键的一部分，同一张图重复渲染时 id 稳定 */
const hashSource = (code: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export function useMermaidSvg(code: string, enabled: boolean): MermaidRenderState {
  const { resolvedTheme } = useTheme();
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [state, setState] = useState<MermaidRenderState>({ status: "fallback" });
  const source = code.trim();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    if (!enabled || !source) {
      setState((prev) => (prev.status === "fallback" ? prev : { status: "fallback" }));
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.status === "rendering" ? prev : { status: "rendering" }));
    const renderId = `${brand.slug}-mermaid-${idPrefix}-${hashSource(source)}`;
    renderInQueue(isDark, renderId, source).then(
      ({ svg }) => {
        if (!cancelled) setState({ status: "ready", svg });
      },
      () => {
        if (!cancelled)
          setState((prev) => (prev.status === "fallback" ? prev : { status: "fallback" }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, idPrefix, isDark, source]);

  return state;
}
