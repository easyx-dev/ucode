/**
 * i18next 的 house 约定：所有端共用一份，避免各端各写一套 init 选项。
 *
 * 与 `createI18n` 配套；直接改这里会影响 server / web / 未来的 TUI、Electron。
 */
import { LOCALES, type Locale } from "@ucode/contracts";
import type { InitOptions } from "i18next";

export const houseOptions = (lng: Locale): InitOptions => ({
  lng,
  // key 即文案，找不到时回退到 key 本身并照常插值；各语言的登记范围由 scripts/verify 保证
  fallbackLng: false,
  supportedLngs: [...LOCALES],
  // 出参多是 JSON / 终端文本而非 HTML，统一关闭插值转义
  interpolation: { escapeValue: false },
  // 中文 key 可能含 `.` 与 `:`（如「设置.说明」），一律按字面量处理，不拆命名空间
  keySeparator: false,
  nsSeparator: false,
});
