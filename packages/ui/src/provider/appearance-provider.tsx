/**
 * 外观偏好的运行时注入：Provider 读取本地偏好、写到文档根节点，并把读写入口下发给设置面板。
 *
 * 偏好只有一处真相（`lib/appearance`），组件不各自读写 localStorage；
 * 应用效果全部落在 CSS 变量与 `data-theme` 上，所以改偏好不触发业务组件重渲染。
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

import {
  type AppearancePrefs,
  applyAppearance,
  loadAppearanceFonts,
  normalizeAppearance,
  PERSIST_DELAY_MS,
  readAppearance,
  writeAppearance,
} from "../lib/appearance";

type AppearanceValue = {
  /** 当前外观偏好 */
  prefs: AppearancePrefs;
  /** 局部更新：合并并收窄，立即生效（落盘按 `PERSIST_DELAY_MS` 防抖） */
  setPrefs: (patch: Partial<AppearancePrefs>) => void;
};

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<AppearancePrefs>(readAppearance);

  useEffect(() => {
    applyAppearance(prefs);
    loadAppearanceFonts(prefs);
  }, [prefs]);

  useEffect(() => {
    // 统一防抖落盘：拖动滑块时只写最后一次，也不必依赖具体收到哪个结束事件
    const timer = setTimeout(() => writeAppearance(prefs), PERSIST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [prefs]);

  const setPrefs = useCallback((patch: Partial<AppearancePrefs>) => {
    setState((prev) => normalizeAppearance({ ...prev, ...patch }));
  }, []);

  return (
    <AppearanceContext.Provider value={{ prefs, setPrefs }}>{children}</AppearanceContext.Provider>
  );
}

/** 取外观偏好；未注入即被使用说明装配顺序有问题 */
export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    // i18n-ignore: 开发者错误，不面向用户
    throw new Error("外观偏好未初始化：请用 <UiProvider> 包裹应用");
  }
  return value;
}
