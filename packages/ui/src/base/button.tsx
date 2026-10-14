import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon-base",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/60",
        outline:
          "border-border bg-background hover:bg-state-hover aria-expanded:bg-state-selected aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-state-hover aria-expanded:bg-state-selected",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/40 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-icon-xs",
        sm: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-icon-sm",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-icon-xs",
        "icon-sm": "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** 悬停说明的方位：竖排工具条（活动栏）用 `right`，其余用默认的上方 */
type TooltipSide = "top" | "right" | "bottom" | "left";

type WithTooltip = {
  /**
   * 悬停说明：讲这个动作是什么、会带来什么结果。原生 `title` 由 Radix 摘不掉，
   * 与 Tooltip 并存会让同一颗按钮先后弹两次（浏览器灰框约 1 秒后才出），所以两者只用其一。
   * 它不参与可访问名——纯图标按钮的可访问名走 `IconButton` 的 `label`。
   *
   * `disabled` 的原生按钮不派发指针 / 焦点事件，此时提示不会出现（悬停有反应反而是坏信号）。
   */
  tooltip?: string;
  /** 悬停说明的方位 */
  tooltipSide?: TooltipSide;
};

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> &
  WithTooltip & {
    /** 把样式与行为交给子元素（Radix `Slot`）；与 `tooltip` 不叠加，提示由子元素自己挂 */
    asChild?: boolean;
  };

function Button({
  asChild = false,
  className,
  size = "default",
  tooltip,
  tooltipSide,
  variant = "default",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const button = (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
  if (!tooltip || asChild) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

type IconButtonProps = Omit<React.ComponentProps<"button">, "title"> &
  VariantProps<typeof buttonVariants> &
  WithTooltip & {
    /** 可访问名；同一份文案兼作悬停说明，一个动作只写一份 */
    label: string;
    /** 开关型动作的当前状态；普通动作不传，不传时不写 `aria-pressed` */
    pressed?: boolean;
  };

/**
 * 纯图标按钮：`label` 同时是 `aria-label` 与悬停说明，按下态给底色。
 *
 * 工作台、表格操作区、消息头、全屏弹层都在用它，「工具条图标按钮」这个名字盖不住。
 * 竖排的工具条（活动栏）传 `tooltipSide="right"`。
 *
 * 注意 ghost 变体自带的 `aria-expanded:bg-state-selected`：带 `aria-expanded` 的显隐开关（展开是常态那种）
 * 会一直挂着一块选中底色，不需要时用 `aria-expanded:bg-transparent` 压掉。
 */
export function IconButton({
  children,
  className,
  label,
  pressed,
  size = "icon-sm",
  tooltip,
  type = "button",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      // 不传 `pressed` 时连 `aria-pressed` 一起写会把调用方自己传的那个值抹掉，所以按需展开
      {...(pressed === undefined ? null : { "aria-pressed": pressed })}
      aria-label={label}
      className={cn(pressed && "bg-muted text-foreground", className)}
      size={size}
      tooltip={tooltip ?? label}
      type={type}
      variant={variant}
    >
      {children}
    </Button>
  );
}

export { Button, buttonVariants };
