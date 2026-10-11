/**
 * 品牌定制唯一入口。
 *
 * B 端交付时改这里的字面量，并替换 `assets/` 下的 logo（浅色 / 深色各一套）与 favicon
 * （图片引用见 `assets.ts`）：浏览器标题、侧栏产品名、空态水印、主题存储键、默认数据目录
 * 与浏览器图标都从这里派生。
 * 改动后跑 `pnpm check`，`scripts/verify` 的 brand 检查会拦下漏改的硬编码品牌名。
 *
 * 本文件同时被 server 通过 `@ucode/brand/values` 加载，禁止在这里 import 图片或其它
 * 需要打包的资源——那些放 `assets.ts`，只由 web 侧消费。
 */
export const brand = {
  /** 产品名：侧栏标题与空态水印 */
  name: "ucode",
  /** 浏览器标签页标题 */
  title: "ucode · AI 对话",
  /** 标识串：用于主题存储键等命名空间，只允许小写字母、数字与连字符 */
  slug: "ucode",
} as const;

export type Brand = typeof brand;

/** 主题存储键：首屏内联脚本与运行时 ThemeProvider 必须一致，由 slug 派生避免重名 */
export const themeStorageKey = `${brand.slug}-theme`;

/** 语言存储键：与主题同理，首屏内联脚本（设 `<html lang>`）与运行时切换共用 */
export const localeStorageKey = `${brand.slug}-locale`;

/**
 * 外观偏好存储键：字号 / 密度 / 字体 / 配色主题。
 * 同样要过首屏内联脚本（`index.html` 的 `%BRAND_APPEARANCE_KEY%`），否则会有一帧默认字号。
 */
export const appearanceStorageKey = `${brand.slug}-appearance`;

/** 会话 token 存储键：浏览器端凭证落 localStorage，与主题 / 语言同属品牌命名空间 */
export const sessionTokenStorageKey = `${brand.slug}-session-token`;

/** 应用主目录名：默认落在用户主目录下（`~/<appHomeDirname>`），随品牌 slug 变化 */
export const appHomeDirname = `.${brand.slug}`;
