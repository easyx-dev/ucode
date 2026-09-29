/** 品牌标识：浅色主题用 `logoLight`、深色主题用 `logoDark`，随 `.dark` 切换 */
import { brandAssets } from "@ucode/brand";

import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** 尺寸与对齐类，透传到图片（如 `size-5`） */
  className?: string;
};

export function BrandLogo({ className }: BrandLogoProps) {
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
