/** 联网搜索设置：websearch 工具的搜索服务商与其前置配置（API Key 或自建实例地址） */
import { useTranslation } from "react-i18next";
import { Input } from "../../base/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../base/select";
import type { DraftWebsearch } from "../../lib/config-draft";
import {
  KEYLESS_SEARCH_PROVIDERS,
  SEARCH_PROVIDER_LABELS,
  SEARCH_PROVIDERS,
  type SearchProviderId,
} from "../../lib/types";
import { SettingsGroup, SettingsRow } from "./settings-row";

/** 自建实例的服务商不需要 key，改填实例地址 */
const isKeyless = (provider: SearchProviderId): boolean =>
  (KEYLESS_SEARCH_PROVIDERS as readonly string[]).includes(provider);

type SettingsWebsearchProps = {
  websearch: DraftWebsearch;
  onPatch: (patch: Partial<DraftWebsearch>) => void;
};

export function SettingsWebsearch({ websearch, onPatch }: SettingsWebsearchProps) {
  const { t } = useTranslation();

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("搜索服务商")}
        description={t("websearch 工具调用哪家搜索接口。")}
        control={
          <Select
            value={websearch.provider}
            onValueChange={(value) => onPatch({ provider: value as SearchProviderId })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_PROVIDERS.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {SEARCH_PROVIDER_LABELS[provider]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {isKeyless(websearch.provider) ? (
        <SettingsRow
          title={t("实例地址")}
          description={t(
            "自建 SearXNG 的地址，需在 settings.yml 里开启 JSON 输出（search.formats 加 json）。",
          )}
          control={
            <Input
              className="w-56"
              value={websearch.baseUrl}
              onChange={(event) => onPatch({ baseUrl: event.target.value })}
              placeholder="http://localhost:8888"
            />
          }
        />
      ) : (
        <SettingsRow
          title="apiKey"
          description={t("留空表示沿用已保存的 key；未配置时 websearch 会返回可读错误。")}
          control={
            <Input
              type="password"
              className="w-56"
              value={websearch.apiKey}
              onChange={(event) => onPatch({ apiKey: event.target.value })}
              placeholder={websearch.configured ? websearch.apiKeyMasked : t("未保存 key")}
            />
          }
        />
      )}
    </SettingsGroup>
  );
}
