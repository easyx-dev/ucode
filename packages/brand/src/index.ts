/** @ucode/brand：品牌名与图片资源的单一来源（web 消费 `brandAssets`，server 只消费 `@ucode/brand/values`） */
// 显式带 .ts 后缀：本包不做构建、直接以 TS 源码被消费，避免 Node 直接加载时的解析歧义
export { brandAssets } from "./assets.ts";
export type { Brand } from "./brand.ts";
export { appHomeDirname, brand, themeStorageKey } from "./brand.ts";
