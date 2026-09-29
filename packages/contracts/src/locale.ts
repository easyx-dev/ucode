/** 语言（locale）常量：各端切换器、持久化与目录合并共用同一份定义 */

/** 受支持的界面语言。新增语种时同步补 `zh-CN` / 对应目录文件 */
export const LOCALES = ["zh-CN", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** 默认语言：未显式选择时用它 */
export const DEFAULT_LOCALE: Locale = "zh-CN";

/** 校验任意值是否为受支持的 locale；用于解析持久化的偏好 */
export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);
