/** thinking 档位选择器：写入当前会话的档位偏好（`自动` 表示按模式推荐值） */
import { Brain, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../base/dropdown-menu";
import { thinkingPreferenceLabel } from "../lib/thinking";
import { THINKING_PREFERENCES, type ThinkingLevel, type ThinkingPreference } from "../lib/types";
import { PICKER_TRIGGER_CLASS, type PickerOption, PickerOptions } from "./picker-options";

type ThinkingPickerProps = {
  value: ThinkingPreference;
  /** 实际生效的档位；`value` 为 `auto` 时显示成「自动 · 极高」。未知（还没有会话）时只显示「自动」 */
  resolved?: ThinkingLevel;
  disabled?: boolean;
  /** 受控打开（`/thinking` 命令从外部唤起）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (preference: ThinkingPreference) => void;
};

export function ThinkingPicker({
  value,
  resolved,
  disabled,
  open,
  onOpenChange,
  onSelect,
}: ThinkingPickerProps) {
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
      <DropdownMenuTrigger
        className={PICKER_TRIGGER_CLASS}
        title={t("思考档位")}
        disabled={disabled}
      >
        <Brain />
        {thinkingPreferenceLabel(value, resolved, t)}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <PickerOptions
          options={THINKING_PREFERENCES.map(
            (preference): PickerOption => ({
              value: preference,
              label: thinkingPreferenceLabel(preference, undefined, t),
            }),
          )}
          value={value}
          onSelect={(next) => onSelect(next as ThinkingPreference)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
