/** 设置行：标题 + 说明 + 右侧控件；若干行用 SettingsGroup 组成一张分组卡 */

import { cn } from "cn";
import type { ReactNode } from "react";

export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-xl ring-1 ring-border-strong",
        className,
      )}
    >
      {children}
    </div>
  );
}

type SettingsRowProps = {
  title: string;
  /** 补充说明，解释该选项的影响；没有说明时省略 */
  description?: string;
  /** 右侧控件：开关、下拉、分段控件或按钮 */
  control: ReactNode;
  /** 少一档内边距，用于同一分组内连续出现多个控件 */
  dense?: boolean;
  className?: string;
};

/** 一行设置；组内相邻行之间由 group 的 divide 分隔 */
export function SettingsRow({ title, description, control, dense, className }: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-6 bg-popover",
        dense ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium">{title}</div>
        {description ? (
          <p className="text-xs leading-relaxed text-foreground-subtle">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
