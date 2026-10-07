/**
 * 是否处于桌面断点（`md`，宽 ≥ 768px）。
 *
 * 三栏布局与移动端抽屉是两套结构：窄屏下侧栏与工作台是 Sheet，不能参与分栏计算，
 * 因此要按断点决定「是否渲染成面板」，而不是用 CSS 隐藏（隐藏后面板仍占布局份额）。
 */
import { useEffect, useState } from "react";

const QUERY = "(min-width: 768px)";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = (): void => setIsDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
