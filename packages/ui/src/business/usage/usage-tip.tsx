/**
 * 图表内的悬停提示：绝对定位在图表容器里的一块浮层。
 *
 * 不用门户与浮层库，位置与展开方向由调用方按格子几何算好；
 * 贴近容器顶部的格子改成向下展开，避免被滚动容器裁掉。
 */
import { cn } from "cn";

/** `x` / `y` 为相对图表容器的像素坐标 */
export type HoverTip = {
  x: number;
  y: number;
  text: string;
  /** 为真时向下展开，默认向上 */
  below?: boolean;
};

export function UsageTip({ tip }: { tip: HoverTip | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-10 -translate-x-1/2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground ring-1 ring-foreground/10 shadow-sm",
        tip.below ? "" : "-translate-y-full",
      )}
      style={{ left: tip.x, top: tip.below ? tip.y + 10 : tip.y - 4 }}
    >
      {tip.text}
    </div>
  );
}
