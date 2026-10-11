/**
 * 模式 / 权限 / 思考三个选择器共用的东西：触发钮样式与「图标 + 标题 + 副标题」的选项体。
 *
 * 互斥且带说明的选项用菜单的 radio 组（Radix 自带 `role="menuitemradio"`、方向键与焦点回收），
 * `select` 塞不下副标题；三者保持同形，不因思考档位没有说明就混用两种控件。
 */
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../base/dropdown-menu";

/** 工具栏里的轻量按钮：图标 + 文案，无边框、悬停才给底色 */
export const PICKER_TRIGGER_CLASS =
  "flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground-subtle hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:bg-transparent dark:hover:bg-state-hover [&_svg]:size-icon-sm";

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
