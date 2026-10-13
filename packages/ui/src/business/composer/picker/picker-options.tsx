/**
 * 输入区工具栏里几个弹层（模型 / 模式 / 权限 / 思考 / 「+」菜单）共用的东西：
 * 触发钮样式、「图标 + 标题 + 副标题」的选项体，以及关闭时的焦点口径。
 *
 * 互斥且带说明的选项用菜单的 radio 组（Radix 自带 `role="menuitemradio"`、方向键与焦点回收），
 * `select` 塞不下副标题；模式 / 权限 / 思考三个下拉保持同形，不因思考档位没有说明就混用两种控件。
 */
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { useRef } from "react";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../../../base/dropdown-menu";

/**
 * 工具栏里的轻量按钮：图标 + 文案，无边框、悬停才给底色。
 * `min-w-0` 是为模型选择器留的——它的文案最长，需要能截断而不是把整行撑开。
 */
export const PICKER_TRIGGER_CLASS =
  "flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground-subtle outline-none transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-transparent dark:hover:bg-state-hover [&_svg]:size-icon-sm";

/**
 * 触发钮里的文案：容器窄于阈值就整条收起，只留图标（回退成 `title` 作为无障碍名）。
 * 阈值按「四个触发钮 + 发送都排得下、模型名还不必截断」定（见 docs/design-surfaces.md「输入区」），
 * 用容器查询而不是窗口断点——输入卡的宽度由分栏与面板共同决定，与窗口宽度无关；
 * `@container` 落在这行工具栏上（composer.tsx）。
 */
export const PICKER_TRIGGER_LABEL_CLASS = "hidden @[36rem]:inline";

/**
 * 弹层关闭时的焦点口径：让开 Radix 默认的「焦点还给触发钮」，交给调用方（输入区把焦点收回编辑器）。
 *
 * 只处理「在弹层里选完 / 按 `Esc` 关掉」这一类——工具栏的下一步总是接着打字，触发钮不是归宿。
 * 点在外面不插手：焦点按 Radix 自己那一套走（模态下拉关闭时它会主动把焦点收给触发钮）。
 *
 * 交还放在 `onCloseAutoFocus` 而不是关闭的那一刻：那一刻弹层还没卸载，它的 FocusScope 仍开着焦点陷阱
 * （模态弹层的 `trapped`），聚焦弹层外的元素会被 `focusin` 立刻拉回弹层里——那个陷阱的监听器正是在
 * 卸载清理里摘掉、并在同一个宏任务里派发 `onCloseAutoFocus` 的，那时聚焦才拿得住。
 */
export const usePickerCloseFocus = (
  onRefocus?: () => void,
): { onInteractOutside: () => void; onCloseAutoFocus: (event: Event) => void } => {
  const interactedOutside = useRef(false);
  return {
    onInteractOutside: () => {
      interactedOutside.current = true;
    },
    onCloseAutoFocus: (event: Event) => {
      if (interactedOutside.current) {
        interactedOutside.current = false;
        return;
      }
      event.preventDefault();
      onRefocus?.();
    },
  };
};

export type PickerOption = {
  value: string;
  label: string;
  /** 副标题：这一档会做什么 / 放宽什么；缺省则不占行 */
  description?: string;
  icon?: LucideIcon;
};

type PickerOptionsProps = {
  options: readonly PickerOption[];
  value: string;
  onSelect: (value: string) => void;
};

export function PickerOptions({ options, value, onSelect }: PickerOptionsProps) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={onSelect}>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <DropdownMenuRadioItem
            key={option.value}
            value={option.value}
            // 带副标题的行撑高一点才不显拥挤；只有一行标题的（如思考档位）保持紧凑
            className={cn(
              "cursor-pointer items-start gap-1.5",
              option.description ? "py-2" : "py-1.5",
            )}
          >
            {/* 图标占一列，标题与副标题都从图标之后起排，两行描述不会各偏各的 */}
            {Icon ? <Icon className="mt-0.5" /> : null}
            <span className="flex flex-col gap-1">
              <span>{option.label}</span>
              {option.description ? (
                <span className="text-xs text-foreground-subtle">{option.description}</span>
              ) : null}
            </span>
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}
