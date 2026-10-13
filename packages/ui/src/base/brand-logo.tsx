/** 品牌标识：浅色主题用浅色档资源、深色主题用深色档，随 `.dark` 切换 */
import { brandAssets } from "@ucode/brand";

import { cn } from "cn";

type BrandAssetProps = {
  /** 尺寸与对齐类，透传到图片（如 `size-icon-lg`） */
  className?: string;
};

/** 带底板的品牌图：侧栏、登录页等独立出现的场合 */
export function BrandLogo({ className }: BrandAssetProps) {
  return (
    <>
      <img
        src={brandAssets.logoLight}
        alt=""
        className={cn("shrink-0 object-contain", className, "dark:hidden")}
      />
      <img
        src={brandAssets.logoDark}
        alt=""
        className={cn("hidden shrink-0 object-contain", className, "dark:block")}
      />
    </>
  );
}

/**
 * 品牌字样：线稿写法的产品名，只用于大面积淡化的场合（空态水印）。
 * 带底板的 logo 淡化后是一个实心方块，字样反而更像水印。
 */
export function BrandWordmark({ className }: BrandAssetProps) {
  return (
    <>
      <img
        src={brandAssets.wordmarkLight}
        alt=""
        className={cn("shrink-0 object-contain", className, "dark:hidden")}
      />
      <img
        src={brandAssets.wordmarkDark}
        alt=""
        className={cn("hidden shrink-0 object-contain", className, "dark:block")}
      />
    </>
  );
}
