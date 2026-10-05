/** 助手模式选择器：切换当前会话的能力三元组（工具 / 权限 / 提示词） */
import { Compass } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../base/select";
import { modeDescription, modeLabel } from "../lib/mode";
import { SESSION_MODES } from "../lib/types";

type ModePickerProps = {
  value: string;
  disabled?: boolean;
  /** 受控打开（`/mode` 命令从外部唤起）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (mode: string) => void;
};

export function ModePicker({ value, disabled, open, onOpenChange, onSelect }: ModePickerProps) {
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
      onValueChange={(next) => onSelect(next)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="gap-1 rounded-md border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg]:size-3.5"
        title={t("模式")}
      >
        <Compass />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SESSION_MODES.map((mode) => (
          <SelectItem key={mode} value={mode} title={modeDescription(mode, t)}>
            {modeLabel(mode, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
