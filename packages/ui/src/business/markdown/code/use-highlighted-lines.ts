/**
 * 高亮 hook：把一段代码异步折成按行分组的着色片段。
 *
 * 高亮是增强：加载语言、解析语法都可能失败或耗时，因此**未就绪时先给纯文本**（调用方按
 * `lines === null` 渲染），到位后就地替换——同一位置同一容器，不会闪。
 * 结果按「代码 + 语言」缓存一份，切换预览 tab 来回看时不必重算。
 */

import { useEffect, useRef, useState } from "react";
import type { ThemedToken } from "shiki/core";

/** 缓存上限：预览器同时打开的文件不会太多，留一点余量 */
const CACHE_LIMIT = 8;

const cache = new Map<string, ThemedToken[][]>();

const readCache = (key: string): ThemedToken[][] | undefined => cache.get(key);

const writeCache = (key: string, lines: ThemedToken[][]): void => {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, lines);
};

export function useHighlightedLines(
  code: string | undefined,
  language: string | null,
): ThemedToken[][] | null {
  const key = code === undefined ? "" : `${language ?? ""}\u0000${code}`;
  const [lines, setLines] = useState<ThemedToken[][] | null>(() => readCache(key) ?? null);
  // 代码或语言变化后要丢弃上一次的结果；用 ref 记住当前 key，避免旧请求回来覆盖新内容
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    if (code === undefined) {
      setLines(null);
      return;
    }
    const cached = readCache(key);
    if (cached) {
      setLines(cached);
      return;
    }
    setLines(null);
    let cancelled = false;
    // 引擎按需加载：不预览代码就完全不下载 shiki（核心 + 引擎 + 语言各成 chunk）
    void import("./shiki").then(({ highlightLines }) =>
      highlightLines(code, language).then((result) => {
        if (cancelled || currentKey.current !== key) return;
        if (result) writeCache(key, result);
        setLines(result);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [code, key, language]);

  return lines;
}
