/** 助手模式选择器：切换当前会话的能力三元组（工具 / 权限 / 提示词） */
import { ClipboardList, Compass, Hammer, type LucideIcon, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../base/dropdown-menu";
import { SESSION_MODES } from "../../../types";
import { modeDescription, modeLabel } from "./mode";
import {
  PICKER_TRIGGER_CLASS,
  type PickerOption,
  PickerOptions,
  usePickerCloseFocus,
} from "./picker-options";

type ModePickerProps = {
  value: string;
  disabled?: boolean;
  /** 弹层关掉后把焦点交给谁（输入区传编辑器）；点在别处时不会调它 */
  onRefocus?: () => void;
  /** 受控打开（`/mode` 命令从外部唤起）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (mode: string) => void;
};

/** 模式图标：编码动手、计划列清单、问答只答疑 */
const ICONS: Record<string, LucideIcon> = {
  build: Hammer,
  plan: ClipboardList,
  ask: MessageSquare,
};

export function ModePicker({
  value,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onRefocus,
}: ModePickerProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const closeFocus = usePickerCloseFocus(onRefocus);

  return (
    <DropdownMenu
      open={open ?? internalOpen}
      onOpenChange={(next) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      {/* 模式是工具栏里唯一的全局状态：不带图标与下拉箭头，文案在任何容器宽度下都留着 */}
      <DropdownMenuTrigger className={PICKER_TRIGGER_CLASS} title={t("模式")} disabled={disabled}>
        <span>{modeLabel(value, t)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72" {...closeFocus}>
        <PickerOptions
          options={SESSION_MODES.map(
            (mode): PickerOption => ({
              value: mode,
              label: modeLabel(mode, t),
              description: modeDescription(mode, t),
              icon: ICONS[mode] ?? Compass,
            }),
          )}
          value={value}
          onSelect={onSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
