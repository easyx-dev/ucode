/**
 * Mermaid 渲染：图源 → SVG，带三态结果。
 *
 * mermaid 的 `initialize` 是全局状态、`render` 内部是同步布局，多张图并发渲染既会互相踩配置也会卡住
 * 主线程，所以全页共用一个队列，一次只渲染一张。渲染失败（流式未闭合、语法不在支持范围）不是异常
 * 状态，交给调用方回落成源码。
 *
 * 渲染结果按「主题 + 图源」缓存：消息行被虚拟列表反复挂载、卸载，每次都重跑一遍既白花时间，也会让行高
 * 先按源码、再按占位、最后按图跳三次——长会话里翻到一片图时，视口会被这些反复的高度变化拽来拽去。
 * 命中缓存就在首次渲染直接出图，行高首次实测即终值。
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

/** 已渲染的图：键是「主题 + 图源」，同一张图换主题要重画 */
const svgCache = new Map<string, string>();

/**
 * 缓存条数上限：一张图几十 KB，长会话里图多的页面不该把整轮的图都留在内存里。
 * 超出后按插入顺序丢最早的——再次翻回去重画一次而已，代价只是一次排队。
 */
const SVG_CACHE_LIMIT = 200;

const cacheKeyOf = (isDark: boolean, source: string): string =>
  `${isDark ? "dark" : "light"}:${source}`;

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

const rememberSvg = (key: string, svg: string): void => {
  svgCache.set(key, svg);
  while (svgCache.size > SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next();
    if (oldest.done) return;
    svgCache.delete(oldest.value);
  }
};

export function useMermaidSvg(code: string, enabled: boolean): MermaidRenderState {
  const { resolvedTheme } = useTheme();
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const source = code.trim();
  const isDark = resolvedTheme === "dark";
  const cacheKey = cacheKeyOf(isDark, source);
  // 初始态就从缓存取：要渲染的图不该先摆一帧源码或占位（行高会先记成错的，回落时视口被拽走）
  const [state, setState] = useState<MermaidRenderState>(() => {
    if (!enabled || !source) return { status: "fallback" };
    const cached = svgCache.get(cacheKey);
    return cached === undefined ? { status: "rendering" } : { status: "ready", svg: cached };
  });

  useEffect(() => {
    if (!enabled || !source) {
      setState((prev) => (prev.status === "fallback" ? prev : { status: "fallback" }));
      return;
    }
    const cached = svgCache.get(cacheKey);
    if (cached !== undefined) {
      setState((prev) =>
        prev.status === "ready" && prev.svg === cached ? prev : { status: "ready", svg: cached },
      );
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.status === "rendering" ? prev : { status: "rendering" }));
    const renderId = `${brand.slug}-mermaid-${idPrefix}-${hashSource(source)}`;
    renderInQueue(isDark, renderId, source).then(
      ({ svg }) => {
        rememberSvg(cacheKey, svg);
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
  }, [enabled, idPrefix, isDark, source, cacheKey]);

  return state;
}
