/**
 * diff 视图的展示偏好：统一 / 双栏，以及是否自动换行，改了就落盘。
 *
 * 默认双栏——diff 的用法就是「改动前后对照」，并排读最直接；换行默认关——长行本该伸长，
 * 折行会把两侧的行高彻底打乱。工作台的 git 面板与消息流的改动卡片共用这一份偏好。
 *
 * 同屏可能摆着好几份 diff 与好几个控件（多个标签、每条写盘一张改动卡片），所以状态取模块级订阅：
 * 一处切换，别处的开关与视图立刻跟上（与表格的自动换行同一套做法）。存储不可用（隐私模式）
 * 由 `utils/storage` 兜住，存量值不认识则回落到默认值。
 */
import { brand } from "@ucode/brand/values";
import { useSyncExternalStore } from "react";

import { readStorage, writeStorage } from "../utils/storage";

export type DiffMode = "unified" | "split";

export const DEFAULT_DIFF_MODE: DiffMode = "split";
export const DEFAULT_DIFF_WRAP = false;

const MODE_KEY = `${brand.slug}-diff-mode`;
const WRAP_KEY = `${brand.slug}-diff-wrap`;

/** 存量的原始值 → 展示方式；不认识的值一律回落到默认 */
export const diffModeOf = (raw: string | null): DiffMode =>
  raw === "unified" ? "unified" : DEFAULT_DIFF_MODE;

/** 存量的原始值 → 是否自动换行；只认 `"true"` */
export const diffWrapOf = (raw: string | null): boolean => raw === "true";

type DiffPrefs = { mode: DiffMode; wrap: boolean };

const readPrefs = (): DiffPrefs => ({
  mode: diffModeOf(readStorage(MODE_KEY)),
  wrap: diffWrapOf(readStorage(WRAP_KEY)),
});

let prefs = readPrefs();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): DiffPrefs => prefs;

/** 副作用（写 localStorage 与广播）不当成 setState 的 updater：updater 必须是纯函数 */
const setPrefs = (patch: Partial<DiffPrefs>): void => {
  const next = { ...prefs, ...patch };
  if (next.mode === prefs.mode && next.wrap === prefs.wrap) return;
  prefs = next;
  writeStorage(MODE_KEY, next.mode);
  writeStorage(WRAP_KEY, String(next.wrap));
  for (const listener of listeners) listener();
};

export type DiffPreferences = {
  mode: DiffMode;
  wrap: boolean;
  selectMode: (mode: DiffMode) => void;
  toggleWrap: () => void;
};

export function useDiffPreferences(): DiffPreferences {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    mode: current.mode,
    wrap: current.wrap,
    selectMode: (mode) => setPrefs({ mode }),
    // 读模块变量而不是本轮的 `current`：连点两次时第二次也该按第一次的结果取反
    toggleWrap: () => setPrefs({ wrap: !prefs.wrap }),
  };
}
