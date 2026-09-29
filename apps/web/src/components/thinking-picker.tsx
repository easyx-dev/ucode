/** thinking level 选择器：写入当前会话的覆盖值，用中文档位名展示 */
import { Brain } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/types";

/** 档位名 → 界面文案；接口值仍是 THINKING_LEVELS 里的英文标识 */
const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "极少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

type ThinkingPickerProps = {
  value: ThinkingLevel;
  disabled?: boolean;
  onSelect: (level: ThinkingLevel) => void;
};

export function ThinkingPicker({ value, disabled, onSelect }: ThinkingPickerProps) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onSelect(next as ThinkingLevel)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="gap-1 rounded-md border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg]:size-3.5"
        title="思考档位"
      >
        <Brain />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {THINKING_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {THINKING_LABELS[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
