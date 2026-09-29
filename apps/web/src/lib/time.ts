/** 会话列表用的相对时间标签（基于 dayjs，中文 locale） */
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

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
