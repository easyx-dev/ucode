/** 全局默认值：默认模型与 thinking 档位，按「设置行」排布 */
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/types";

/** 与 ThinkingPicker 保持同一套中文档位名 */
const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "极少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

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
    <SettingsGroup>
      <SettingsRow
        title="默认模型"
        description="新建会话时使用的模型；会话内可以单独覆盖。"
        control={
          <Select
            value={options.some((option) => option.value === defaultModel) ? defaultModel : ""}
            onValueChange={onSelectDefaultModel}
          >
            <SelectTrigger className="w-56">
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
        }
      />

      <SettingsRow
        title="默认思考档位"
        description="未单独设置档位的会话使用该值；模型本身需支持思考。"
        control={
          <Select
            value={thinkingLevel}
            onValueChange={(value) => onSelectThinkingLevel(value as ThinkingLevel)}
          >
            <SelectTrigger className="w-32">
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
        }
      />
    </SettingsGroup>
  );
}
