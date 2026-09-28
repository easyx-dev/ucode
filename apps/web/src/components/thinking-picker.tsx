/** thinking level 选择器：写入当前会话的覆盖值 */
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
  return (
    <Select
      value={value}
      onValueChange={(next) => onSelect(next as ThinkingLevel)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-28">
        <SelectValue placeholder="thinking" />
      </SelectTrigger>
      <SelectContent>
        {THINKING_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {level}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
