/**
 * 资源导入的模块声明（图片与音频）。
 *
 * 品牌包不依赖 Vite（也不在 tsconfig 里引入 `vite/client`），这里就地声明
 * `import url from "./x.png"` 的类型；Vite 侧仍按自身规则解析成资源 URL。
 *
 * 注意：文件名不能叫 `assets.d.ts`——TypeScript 会忽略与同目录 `.ts` 同名的 `.d.ts`。
 */
declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*.jpg" {
  const url: string;
  export default url;
}

declare module "*.jpeg" {
  const url: string;
  export default url;
}

declare module "*.webp" {
  const url: string;
  export default url;
}

declare module "*.gif" {
  const url: string;
  export default url;
}

declare module "*.avif" {
  const url: string;
  export default url;
}

declare module "*.ico" {
  const url: string;
  export default url;
}

declare module "*.wav" {
  const url: string;
  export default url;
}
