/** 表单输入族：单行 `Input` 与带放大镜的 `InputSearch`，底座类由 `Textarea` 复用 */
import { cn } from "cn";
import { Search } from "lucide-react";
import type * as React from "react";

/**
 * 输入类控件的底座：描边、底色、占位、焦点环、非法态与禁用态。
 * 高度、内边距与字号随控件而定（`Input` 是 `h-8`，`Textarea` 是随内容增高的自动高度）。
 *
 * 不带 `file:*`（原生文件选择按钮的样式）：本项目不用 `Input` 渲染文件选择按钮——上传入口是
 * 一个隐藏的裸 `input[type=file]`，由菜单项触发（见 `business/composer/add-menu.tsx`）。
 */
export const INPUT_BASE_CLASS =
  "w-full min-w-0 rounded-lg border border-border bg-transparent transition-colors outline-none placeholder:text-foreground-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      // 移动端 16px 起（iOS 聚焦时不会缩放页面），桌面端回到 text-sm
      className={cn(INPUT_BASE_CLASS, "h-8 px-2.5 py-1 text-base md:text-sm", className)}
      {...props}
    />
  );
}

/**
 * 带放大镜的搜索输入行：放大镜绝对定位于输入框左侧，输入框自己留出它的位置。
 *
 * 弹层里的搜索行常把描边与底色交给外层容器（调用点传 `border-0 bg-transparent`），
 * 高度与左内边距也随容器变，都由 `className` 覆盖。紧凑档要连窄屏那档一起覆盖（`text-xs md:text-xs`）：
 * `Input` 在窄屏固定 16px 是为了不让 iOS 聚焦时缩放页面，单写 `text-xs` 被它压过。
 */
function InputSearch({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <div className="relative min-w-0">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 size-icon-sm -translate-y-1/2 text-foreground-subtle"
      />
      <Input className={cn("pl-7", className)} {...props} />
    </div>
  );
}

export { Input, InputSearch };
