/** thinking 档位选择器：写入当前会话的档位偏好（`自动` 表示按模式推荐值） */
import { Brain } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../base/select";
import { thinkingPreferenceLabel } from "../lib/thinking";
import { THINKING_PREFERENCES, type ThinkingLevel, type ThinkingPreference } from "../lib/types";

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
    <Select
      value={value}
      open={open ?? internalOpen}
      onOpenChange={(next) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
      onValueChange={(next) => onSelect(next as ThinkingPreference)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="gap-1 rounded-md border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg]:size-3.5"
        title={t("思考档位")}
      >
        <Brain />
        {/* 必须用 SelectValue：Radix 的 item-aligned 定位靠它拿 `valueNode`，不带就会渲在页面末尾（看起来像“点了没反应”）。
            它自带 children 时不会再把手选项的文字 portal 进来，所以这里可以放自己算好的档位文案 */}
        <SelectValue>{thinkingPreferenceLabel(value, resolved, t)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {THINKING_PREFERENCES.map((preference) => (
          <SelectItem key={preference} value={preference}>
            {thinkingPreferenceLabel(preference, undefined, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
