/** 全局默认值：默认模型与 thinking 档位，按「设置行」排布 */
import { useTranslation } from "react-i18next";

import { SettingsGroup, SettingsRow } from "@/components/settings/settings-row";
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
  const { t } = useTranslation();

  /** 与 ThinkingPicker 保持同一套中文档位名 */
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
    <SettingsGroup>
      <SettingsRow
        title={t("默认模型")}
        description={t("默认模型.说明")}
        control={
          <Select
            value={options.some((option) => option.value === defaultModel) ? defaultModel : ""}
            onValueChange={onSelectDefaultModel}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder={t("选择默认模型")} />
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
        title={t("默认思考档位")}
        description={t("默认思考档位.说明")}
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
                  {labels[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroup>
  );
}
