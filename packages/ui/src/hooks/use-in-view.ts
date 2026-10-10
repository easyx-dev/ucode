/**
 * 元素是否进入过视口（只翻一次，滚走也不会变回去）。
 *
 * 堆叠视图里每个文件块都要取一次 diff：几十个文件同时取会把本地服务打满，首屏也会卡住。
 * 于是块内容在进入视口前不挂载；一旦挂载就不再卸载，来回滚动不会重复请求。
 * 没有 `IntersectionObserver` 时（测试环境）直接算进入视口，别把内容卡住。
 */
import { type RefCallback, useCallback, useState } from "react";

/** 提前量：视口外这么远就开始加载，滚动到跟前时内容已经在了 */
const DEFAULT_ROOT_MARGIN = "600px";

export function useInViewOnce<T extends Element>(
  rootMargin: string = DEFAULT_ROOT_MARGIN,
): { ref: RefCallback<T>; inView: boolean } {
  const [inView, setInView] = useState(false);

  const ref = useCallback<RefCallback<T>>(
    (element) => {
      if (!element) return;
      if (typeof IntersectionObserver === "undefined") {
        setInView(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          setInView(true);
          observer.disconnect();
        },
        { rootMargin },
      );
      observer.observe(element);
      return () => observer.disconnect();
    },
    [rootMargin],
  );

  return { ref, inView };
}
