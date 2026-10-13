/**
 * 品牌图片资源。
 *
 * 换 logo / favicon 只动这里：把 `assets/` 下的文件替换掉，必要时改一下 import 的扩展名
 * （svg / png / jpg / webp … 都可，Vite 会按当前环境解析成可用的 URL）。
 *
 * 三套资源分工：`logo*` 是「底板 + 字形」，用于侧栏、登录页这类独立出现的场合；
 * `wordmark*` 是品牌字样（空态水印用的线稿字样）；`favicon` 是浏览器图标。
 */
import favicon from "../assets/favicon.svg";
import logoDark from "../assets/logo-dark.svg";
import logoLight from "../assets/logo-light.svg";
import wordmarkDark from "../assets/wordmark-dark.svg";
import wordmarkLight from "../assets/wordmark-light.svg";

export const brandAssets = {
  /** 浅色主题 logo（深底板 + 浅字形） */
  logoLight,
  /** 深色主题 logo（浅底板 + 深字形） */
  logoDark,
  /** 浅色主题品牌字样 */
  wordmarkLight,
  /** 深色主题品牌字样 */
  wordmarkDark,
  /** 浏览器图标 */
  favicon,
} as const;
