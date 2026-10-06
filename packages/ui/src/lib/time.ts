/** 会话列表用的相对时间标签（基于 dayjs），展示语言跟随界面语言 */
import type { Locale } from "@ucode/contracts";
import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

/** 把 dayjs 的展示语言切到界面语言；locale 码用 dayjs 的小写写法 */
export const setDayjsLocale = (locale: Locale): void => {
  dayjs.locale(locale === "en" ? "en" : "zh-cn");
};

setDayjsLocale("zh-CN");

/**
 * 距离现在的粗粒度描述，如「几秒前」「55 分钟前」「1 天前」。
 * 会话列表只需要「多久以前」的量级，不做精确到秒的倒计时。
 *
 * 必须先判空：`dayjs(undefined)` 等于 `dayjs()`，会返回当前时间而不是非法时间。
 */
export const relativeTimeLabel = (iso: string, now: Date = new Date()): string => {
  if (!iso) return "";
  const time = dayjs(iso);
  return time.isValid() ? time.from(dayjs(now)) : "";
};

/** 消息元信息里的时刻，如 14:21:19；时间缺失或非法时返回空串（判空理由同 `relativeTimeLabel`） */
export const clockLabel = (iso?: string): string => {
  if (!iso) return "";
  const time = dayjs(iso);
  return time.isValid() ? time.format("HH:mm:ss") : "";
};

/** 耗时标签：毫秒 → 紧凑可读（840ms / 3.2s / 1m05s / 1h02m），非法值返回空串 */
export const durationLabel = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  // 先按一位小数取整再判断进位，避免 59.96s 显示成 60.0s
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
};
