import { cn } from "cn";
import { Loader2 } from "lucide-react";

/** 全站统一的加载指示：只有这一处定义图标与动效，调用方只在尺寸上覆盖 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("size-icon-sm shrink-0 animate-spin", className)} />;
}
