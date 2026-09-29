/**
 * 品牌图片资源。
 *
 * 换 logo / favicon 只动这里：把 `assets/` 下的文件替换掉，必要时改一下 import 的扩展名
 * （svg / png / jpg / webp … 都可，Vite 会按当前环境解析成可用的 URL）。
 */
import favicon from "../assets/favicon.svg";
import logoDark from "../assets/logo-dark.svg";
import logoLight from "../assets/logo-light.svg";

export const brandAssets = {
  /** 浅色主题 logo */
  logoLight,
  /** 深色主题 logo */
  logoDark,
  /** 浏览器图标 */
  favicon,
} as const;
