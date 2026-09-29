/** thinking level 选择器：写入当前会话的覆盖值，用中文档位名展示 */
import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/types";

type ThinkingPickerProps = {
  value: ThinkingLevel;
  disabled?: boolean;
  onSelect: (level: ThinkingLevel) => void;
};

export function ThinkingPicker({ value, disabled, onSelect }: ThinkingPickerProps) {
  const { t } = useTranslation();
  /** 档位名 → 界面文案；接口值仍是 THINKING_LEVELS 里的英文标识 */
  const labels: Record<ThinkingLevel, string> = {
    off: t("关闭"),
    minimal: t("极少"),
    low: t("低"),
    medium: t("中"),
    high: t("高"),
    xhigh: t("极高"),
    max: t("最高"),
  };

  return (
    <Select
      value={value}
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
            {labels[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
