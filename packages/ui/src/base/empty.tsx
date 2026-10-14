/**
 * 空态：居中图标 + 主文案 + 说明 + 下一步动作（`DESIGN.md` 的空态五要素）。
 *
 * 只给内容与排版，不给外壳——面板占位要撑满高度、设置里的占位要虚线框，都由调用方从 `className` 传，
 * 不在这里开样式开关。
 */
import { cn } from "cn";
import type { ReactNode } from "react";

type EmptyProps = {
  /** 图标元素，尺寸由调用方给（如 `<FileWarning className="size-7" />`）；省略即只有文字 */
  icon?: ReactNode;
  /** 主文案：这是什么、为什么没有内容 */
  title: string;
  /** 补充说明：位置、原因或下一步的提示 */
  hint?: string;
  /** 下一步动作；空态应当给出一个出口 */
  action?: ReactNode;
  /** 外壳类名：虚线框、内边距与高度按调用处的场景给 */
  className?: string;
};

export function Empty({ action, className, hint, icon, title }: EmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-8 text-center",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden className="text-foreground-subtle">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-md text-xs text-foreground-subtle">{hint}</p> : null}
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
