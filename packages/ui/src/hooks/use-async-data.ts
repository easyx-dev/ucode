/**
 * 一次性异步取数的通用形态：loading / data / error，随 `key` 与 `reloadToken` 变化重取。
 *
 * 用 `key` 而不是依赖数组来表达「取什么」：调用方把参数拼成一个字符串，
 * 依赖就是两个字面量，既不会因为数组字面量每次新建而反复重取，也能看出重取的触发条件。
 * 组件卸载或 key 变化时丢弃在途结果，避免慢响应覆盖新内容。
 */
import { type ApiError, asApiError } from "@ucode/sdk";
import { useEffect, useRef, useState } from "react";

export type AsyncData<T> = {
  data: T | null;
  error: ApiError | null;
  /** 正在加载（含 key 变化后的重新加载） */
  loading: boolean;
};

export function useAsyncData<T>(
  key: string,
  load: () => Promise<T>,
  reloadToken = 0,
): AsyncData<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<AsyncData<T>>({ data: null, error: null, loading: true });
  /** 上一次的 key：用来区分「换了一个目标」与「重取同一目标」 */
  const lastKey = useRef(key);

  useEffect(() => {
    let cancelled = false;
    // 重取同一目标（刷新）时保留旧数据，界面不闪回空态；
    // 换成别的目标时必须清空，否则会短暂出现「新的标题 / 头部 + 旧的内容」
    const sameTarget = lastKey.current === key;
    lastKey.current = key;
    setState((prev) => ({ data: sameTarget ? prev.data : null, error: null, loading: true }));
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (!cancelled) setState({ data: null, error: asApiError(error), loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, reloadToken]);

  return state;
}
