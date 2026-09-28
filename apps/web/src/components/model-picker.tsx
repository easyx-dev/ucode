/** 模型选择器：在已配置的 provider/模型里切换当前会话使用的模型 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CatalogProvider } from "@/lib/types";

type ModelPickerProps = {
  providers: CatalogProvider[];
  /** 当前生效的 "provider/model" */
  value: string;
  disabled?: boolean;
  onSelect: (model: string) => void;
};

export const modelOptions = (
  providers: CatalogProvider[],
): Array<{ value: string; label: string }> =>
  providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.id}/${model.id}`,
      label: `${provider.name} · ${model.name}`,
    })),
  );

export function ModelPicker({ providers, value, disabled, onSelect }: ModelPickerProps) {
  const options = modelOptions(providers);
  const current = options.some((option) => option.value === value) ? value : undefined;

  return (
    <Select value={current} onValueChange={onSelect} disabled={disabled}>
      <SelectTrigger size="sm" className="w-52">
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
