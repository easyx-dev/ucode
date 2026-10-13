/** thinking 档位选择器：写入当前会话的档位偏好（`自动` 表示按模式推荐值） */
import { Brain, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../base/dropdown-menu";
import { THINKING_PREFERENCES, type ThinkingLevel, type ThinkingPreference } from "../../../types";
import { thinkingPreferenceLabel } from "../../../utils/thinking";
import {
  PICKER_TRIGGER_CLASS,
  PICKER_TRIGGER_LABEL_CLASS,
  type PickerOption,
  PickerOptions,
  usePickerCloseFocus,
} from "./picker-options";

type ThinkingPickerProps = {
  value: ThinkingPreference;
  /** 实际生效的档位；`value` 为 `auto` 时显示成「自动 · 极高」。未知（还没有会话）时只显示「自动」 */
  resolved?: ThinkingLevel;
  disabled?: boolean;
  /** 弹层关掉后把焦点交给谁（输入区传编辑器）；点在别处时不会调它 */
  onRefocus?: () => void;
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
  onRefocus,
}: ThinkingPickerProps) {
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
      <DropdownMenuTrigger
        className={PICKER_TRIGGER_CLASS}
        title={t("思考档位")}
        disabled={disabled}
      >
        <Brain />
        <span className={PICKER_TRIGGER_LABEL_CLASS}>
          {thinkingPreferenceLabel(value, resolved, t)}
        </span>
        <ChevronDown />
      </DropdownMenuTrigger>
      {/* 档位只有单字标签，比模式 / 权限那两栏窄：宽度跟着内容收，不留空半栏 */}
      <DropdownMenuContent side="top" align="start" className="w-40" {...closeFocus}>
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
