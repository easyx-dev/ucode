/**
 * diff 视图的偏好状态：展示方式与自动换行，改了就落盘。
 *
 * 单文件标签与「全部改动」堆叠共用同一份偏好（读的是同一组键），在哪儿切换都记住。
 */
import { useState } from "react";

import {
  type DiffMode,
  readDiffMode,
  readDiffWrap,
  writeDiffMode,
  writeDiffWrap,
} from "../lib/diff-prefs";

export type DiffPreferences = {
  mode: DiffMode;
  wrap: boolean;
  selectMode: (mode: DiffMode) => void;
  toggleWrap: () => void;
};

export function useDiffPreferences(): DiffPreferences {
  const [mode, setMode] = useState<DiffMode>(readDiffMode);
  const [wrap, setWrap] = useState(readDiffWrap);

  return {
    mode,
    wrap,
    selectMode: (next) => {
      setMode(next);
      writeDiffMode(next);
    },
    toggleWrap: () => {
      // 副作用（写 localStorage）不能放 setState 的 updater 里：updater 必须是纯函数
      const next = !wrap;
      setWrap(next);
      writeDiffWrap(next);
    },
  };
}
