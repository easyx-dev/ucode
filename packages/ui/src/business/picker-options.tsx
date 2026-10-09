/**
 * 模式 / 权限 / 思考三个选择器共用的东西：触发钮样式与「图标 + 标题 + 副标题」的选项体。
 *
 * 互斥且带说明的选项用菜单的 radio 组（Radix 自带 `role="menuitemradio"`、方向键与焦点回收），
 * `select` 塞不下副标题；三者保持同形，不因思考档位没有说明就混用两种控件。
 */
import type { LucideIcon } from "lucide-react";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../base/dropdown-menu";

/** 工具栏里的轻量按钮：图标 + 文案，无边框、悬停才给底色 */
export const PICKER_TRIGGER_CLASS =
  "flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:bg-transparent dark:hover:bg-muted [&_svg]:size-3.5";

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
            className="flex-col items-start gap-0.5 py-1.5"
          >
            <span className="flex items-center gap-1.5 text-sm">
              {Icon ? <Icon /> : null}
              {option.label}
            </span>
            {option.description ? (
              <span className="text-xs text-muted-foreground">{option.description}</span>
            ) : null}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}
