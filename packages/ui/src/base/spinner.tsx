/** 全站统一的加载指示：只有这一处定义图标与动效，调用方只在尺寸上覆盖 */
import { cn } from "cn";
import { Loader2 } from "lucide-react";

type SpinnerProps = {
  /** 尺寸与颜色类，透传到图标（如 `size-icon-base`） */
  className?: string;
};

export function Spinner({ className }: SpinnerProps) {
  return <Loader2 aria-hidden className={cn("size-icon-sm shrink-0 animate-spin", className)} />;
}
