/** thinking level 选择器：写入当前会话的覆盖值，用中文档位名展示 */
import { Brain } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../base/select";
import { thinkingLevelLabel } from "../lib/thinking";
import { THINKING_LEVELS, type ThinkingLevel } from "../lib/types";

type ThinkingPickerProps = {
  value: ThinkingLevel;
  disabled?: boolean;
  /** 受控打开（`/thinking` 命令从外部唤起）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (level: ThinkingLevel) => void;
};

export function ThinkingPicker({
  value,
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
      onValueChange={(next) => onSelect(next as ThinkingLevel)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="gap-1 rounded-md border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg]:size-3.5"
        title={t("思考档位")}
      >
        <Brain />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {THINKING_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {thinkingLevelLabel(level, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
