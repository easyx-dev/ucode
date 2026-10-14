/** 分段控件：灰底容器 + 选中白底 pill，用于少量互斥选项的即时切换 */

import { cn } from "cn";
import { useId } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** 可选的选项图标；窄栏（如预览工具条）用它省文字宽度 */
  icon?: React.ReactNode;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  /** 无障碍必填：整组选项的名称，如「界面主题」 */
  label: string;
  className?: string;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();

  return (
    <fieldset
      className={cn(
        // 自身不可压缩、选项不折行：窄栏里宁可挤掉旁边的文字，也不要把选项压成竖排
        "inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              // 与容器同心：外圈 rounded-md 减掉 p-0.5 的内边距，落在 rounded-sm 上
              "flex cursor-pointer items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              "has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
              selected
                ? "bg-card text-foreground shadow-raised"
                : "text-foreground-subtle hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon}
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
