/**
 * 构建期把品牌值注入 `index.html` 的 Vite 插件。
 *
 * 只处理构建期才能定型、且不适合放到运行时的两项：浏览器标题与首屏主题 / 语言存储键。
 * 用包的 node 入口（`./brand.ts`）——它不含图片 import，Node 能直接加载；
 * 图片资源由各端在应用侧引用。
 */
import type { Plugin } from "vite";

import { brand, localeStorageKey, themeStorageKey } from "./brand.ts";

export const brandHtml = (): Plugin => ({
  name: "brand-html",
  transformIndexHtml: (html) =>
    html
      // 用函数替换：品牌标题可能含 `$&` 这类替换模式，字符串替换会把它当占位符
      .replaceAll("%BRAND_TITLE%", () => brand.title)
      .replaceAll("%BRAND_THEME_KEY%", () => themeStorageKey)
      .replaceAll("%BRAND_LOCALE_KEY%", () => localeStorageKey),
});
