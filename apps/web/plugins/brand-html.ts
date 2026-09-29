/**
 * 构建期把品牌值注入 `index.html`。
 *
 * 只处理构建期才能定型、且不适合放到运行时的两项：浏览器标题与首屏主题存储键。
 * 这里用包的 node 入口（`@ucode/brand/values`）——它不含图片 import，Node 能直接加载；
 * 图片资源由 `components/brand-logo.tsx` / `brand-head.tsx` 在应用侧引用。
 */
import { brand, localeStorageKey, themeStorageKey } from "@ucode/brand/values";
import type { Plugin } from "vite";

export const brandHtml = (): Plugin => ({
  name: "brand-html",
  transformIndexHtml: (html) =>
    html
      // 用函数替换：品牌标题可能含 `$&` 这类替换模式，字符串替换会把它当占位符
      .replaceAll("%BRAND_TITLE%", () => brand.title)
      .replaceAll("%BRAND_THEME_KEY%", () => themeStorageKey)
      .replaceAll("%BRAND_LOCALE_KEY%", () => localeStorageKey),
});
