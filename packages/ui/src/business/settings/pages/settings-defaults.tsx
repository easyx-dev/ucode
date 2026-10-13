/** 全局默认值：默认模型，按「设置行」排布 */
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../base/select";
import { SettingsGroup, SettingsRow } from "../settings-row";

type SettingsDefaultsProps = {
  options: Array<{ value: string; label: string }>;
  defaultModel: string;
  onSelectDefaultModel: (model: string) => void;
};

export function SettingsDefaults({
  options,
  defaultModel,
  onSelectDefaultModel,
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
    </SettingsGroup>
  );
}
