/** 全局默认值：默认模型与 thinking level */
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/types";

type SettingsDefaultsProps = {
  options: Array<{ value: string; label: string }>;
  defaultModel: string;
  thinkingLevel: ThinkingLevel;
  onSelectDefaultModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
};

export function SettingsDefaults({
  options,
  defaultModel,
  thinkingLevel,
  onSelectDefaultModel,
  onSelectThinkingLevel,
}: SettingsDefaultsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs">默认模型</Label>
        <Select
          value={options.some((option) => option.value === defaultModel) ? defaultModel : ""}
          onValueChange={onSelectDefaultModel}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择默认模型" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">thinking level</Label>
        <Select
          value={thinkingLevel}
          onValueChange={(value) => onSelectThinkingLevel(value as ThinkingLevel)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THINKING_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
