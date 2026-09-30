/** 助手模式选择器：切换当前会话的能力三元组（工具 / 权限 / 提示词） */
import { Compass } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { modeDescription, modeLabel } from "@/lib/mode";
import { SESSION_MODES, type SessionMode } from "@/lib/types";

type ModePickerProps = {
  value: SessionMode;
  disabled?: boolean;
  onSelect: (mode: SessionMode) => void;
};

export function ModePicker({ value, disabled, onSelect }: ModePickerProps) {
  const { t } = useTranslation();

  return (
    <Select
      value={value}
      onValueChange={(next) => onSelect(next as SessionMode)}
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
