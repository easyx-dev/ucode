/** provider 的连接信息字段：名称、id、baseUrl、api 类型与 apiKey */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../../base/input";
import { Label } from "../../base/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../base/select";
import type { DraftProvider } from "../../lib/config-draft";
import { API_TYPES, type ApiType } from "../../lib/types";

type ProviderFieldsProps = {
  provider: DraftProvider;
  onPatch: (patch: Partial<DraftProvider>) => void;
};

export function ProviderFields({ provider, onPatch }: ProviderFieldsProps) {
  const { t } = useTranslation();
  // 同一页可能同时挂多个供应商表单，字段 id 用前缀区分
  const fieldId = useId();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-name`}>{t("名称")}</Label>
        <Input
          id={`${fieldId}-name`}
          value={provider.name}
          onChange={(event) => onPatch({ name: event.target.value })}
          placeholder="Local Gateway"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-id`}>id</Label>
        <Input
          id={`${fieldId}-id`}
          value={provider.id}
          onChange={(event) => onPatch({ id: event.target.value })}
          placeholder="local"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-base-url`}>Base URL</Label>
        <Input
          id={`${fieldId}-base-url`}
          value={provider.baseUrl}
          onChange={(event) => onPatch({ baseUrl: event.target.value })}
          placeholder="http://localhost:8317/v1"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-api`}>{t("API 格式")}</Label>
        <Select value={provider.api} onValueChange={(value) => onPatch({ api: value as ApiType })}>
          <SelectTrigger id={`${fieldId}-api`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {API_TYPES.map((api) => (
              <SelectItem key={api} value={api}>
                {api}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-api-key`}>API Key</Label>
        <Input
          id={`${fieldId}-api-key`}
          type="password"
          value={provider.apiKey}
          onChange={(event) => onPatch({ apiKey: event.target.value })}
          placeholder={provider.apiKeyMasked || "sk-..."}
        />
      </div>
    </div>
  );
}
