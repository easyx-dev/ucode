/**
 * diff 视图的展示偏好：统一 / 双栏，以及是否自动换行。
 *
 * 默认双栏——diff 的用法就是「改动前后对照」，并排读最直接；换行默认关——长行本该伸长，
 * 折行会把两侧的行高彻底打乱。切换后记住选择；读写都容错：隐私模式下写不进去、
 * 存量值不认识，都回落到默认值而不是抛错。
 */
import { brand } from "@ucode/brand/values";

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

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 写不进去（隐私模式）不影响使用
  }
};

export const readDiffMode = (): DiffMode => diffModeOf(read(MODE_KEY));

export const writeDiffMode = (mode: DiffMode): void => write(MODE_KEY, mode);

export const readDiffWrap = (): boolean => diffWrapOf(read(WRAP_KEY));

export const writeDiffWrap = (wrap: boolean): void => write(WRAP_KEY, String(wrap));
