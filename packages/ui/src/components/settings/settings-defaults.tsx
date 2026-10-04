/** 全局默认值：默认模型与 thinking 档位，按「设置行」排布 */
import { useTranslation } from "react-i18next";
import { thinkingLevelLabel } from "../../lib/thinking";
import { THINKING_LEVELS, type ThinkingLevel } from "../../lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsGroup, SettingsRow } from "./settings-row";

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

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("默认模型")}
        description={t("新建会话时使用的模型；会话内可以单独覆盖。")}
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
        description={t("未单独设置档位的会话使用该值；模型本身需支持思考。")}
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
                  {thinkingLevelLabel(level, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroup>
  );
}
