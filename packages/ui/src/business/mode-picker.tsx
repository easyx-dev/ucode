/** 助手模式选择器：切换当前会话的能力三元组（工具 / 权限 / 提示词） */
import {
  ChevronDown,
  ClipboardList,
  Compass,
  Hammer,
  type LucideIcon,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../base/dropdown-menu";
import { modeDescription, modeLabel } from "../lib/mode";
import { SESSION_MODES } from "../lib/types";
import { PICKER_TRIGGER_CLASS, type PickerOption, PickerOptions } from "./picker-options";

type ModePickerProps = {
  value: string;
  disabled?: boolean;
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

export function ModePicker({ value, disabled, open, onOpenChange, onSelect }: ModePickerProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;

  return (
    <DropdownMenu
      open={open ?? internalOpen}
      onOpenChange={(next) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      <DropdownMenuTrigger className={PICKER_TRIGGER_CLASS} title={t("模式")} disabled={disabled}>
        <Compass />
        {modeLabel(value, t)}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
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
