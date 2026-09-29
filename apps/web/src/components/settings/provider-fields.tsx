/** provider 的连接信息字段：id、名称、baseUrl、api 类型与 apiKey */
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DraftProvider } from "@/lib/config-draft";
import { API_TYPES, type ApiType } from "@/lib/types";

type ProviderFieldsProps = {
  provider: DraftProvider;
  onPatch: (patch: Partial<DraftProvider>) => void;
};

export function ProviderFields({ provider, onPatch }: ProviderFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs">id</Label>
        <Input
          value={provider.id}
          onChange={(event) => onPatch({ id: event.target.value })}
          placeholder="local"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("名称")}</Label>
        <Input
          value={provider.name}
          onChange={(event) => onPatch({ name: event.target.value })}
          placeholder="Local Gateway"
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-xs">baseUrl</Label>
        <Input
          value={provider.baseUrl}
          onChange={(event) => onPatch({ baseUrl: event.target.value })}
          placeholder="http://localhost:8317/v1"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">api</Label>
        <Select value={provider.api} onValueChange={(value) => onPatch({ api: value as ApiType })}>
          <SelectTrigger className="w-full">
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
        <Label className="text-xs">apiKey</Label>
        <Input
          type="password"
          value={provider.apiKey}
          onChange={(event) => onPatch({ apiKey: event.target.value })}
          placeholder={provider.apiKeyMasked || "sk-..."}
        />
      </div>
    </div>
  );
}
