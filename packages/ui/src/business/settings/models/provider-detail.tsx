/** 供应商详情：内置供应商只需填 key，自定义供应商才编辑端点与模型 */
import { Trash2, Zap } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../base/badge";
import { Button } from "../../../base/button";
import { Input } from "../../../base/input";
import { Label } from "../../../base/label";
import { Spinner } from "../../../base/spinner";
import type { DraftModel, DraftModelFields, DraftProvider } from "../config-draft";
import { ProviderFields } from "./provider-fields";
import { ProviderModels } from "./provider-models";

type ProviderDetailProps = {
  provider: DraftProvider;
  testing: boolean;
  onPatch: (patch: Partial<DraftProvider>) => void;
  onModelPatch: (modelKey: string, patch: Partial<DraftModel>) => void;
  /** 返回新模型的草稿 key，供模型列表直接打开它的编辑对话框 */
  onAddModel: (fields?: DraftModelFields) => string;
  onRemoveModel: (modelKey: string) => void;
  onRemove: () => void;
  onTest: () => void;
};

/** 内置供应商：端点与模型清单来自 pi 内置目录，这里只需要一把 key */
function BuiltinFields({ provider, onPatch }: Pick<ProviderDetailProps, "provider" | "onPatch">) {
  const { t } = useTranslation();
  const fieldId = useId();
  // 配置里给出了 models 即为整体替换，此后不再跟随内置目录更新
  const customized = provider.models.length > 0;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${fieldId}-api-key`}>API Key</Label>
      <Input
        id={`${fieldId}-api-key`}
        type="password"
        value={provider.apiKey}
        onChange={(event) => onPatch({ apiKey: event.target.value })}
        placeholder={provider.apiKeyMasked || "sk-..."}
      />
      {customized ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-foreground-subtle">
            {t("模型清单已被自定义（{{n}} 个），不再随内置目录更新。", {
              n: provider.models.length,
            })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => onPatch({ models: [] })}
          >
            {t("恢复默认")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-foreground-subtle">
          {t("端点与 {{n}} 个模型来自内置目录，随应用升级自动更新。", {
            n: provider.inheritedModels.length,
          })}
        </p>
      )}
    </div>
  );
}

export function ProviderDetail({
  provider,
  testing,
  onPatch,
  onModelPatch,
  onAddModel,
  onRemoveModel,
  onRemove,
  onTest,
}: ProviderDetailProps) {
  const { t } = useTranslation();
  const builtin = provider.source === "builtin";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 truncate text-base font-medium">
          {provider.name || provider.id}
        </span>
        <Badge variant="outline">{builtin ? t("内置") : t("自定义")}</Badge>
        <span className="text-xs text-foreground-subtle">
          {provider.apiKeyMasked
            ? t("已保存 key {{masked}}", { masked: provider.apiKeyMasked })
            : t("未保存 key")}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onTest} disabled={testing}>
            {testing ? <Spinner className="size-icon-base" /> : <Zap className="size-icon-base" />}
            {t("测试连接")}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} title={t("删除 provider")}>
            <Trash2 className="size-icon-base text-destructive" />
          </Button>
        </div>
      </div>

      {builtin ? (
        <BuiltinFields provider={provider} onPatch={onPatch} />
      ) : (
        <>
          <ProviderFields provider={provider} onPatch={onPatch} />
          <ProviderModels
            provider={provider}
            onPatch={onModelPatch}
            onAdd={onAddModel}
            onRemove={onRemoveModel}
          />
        </>
      )}
    </div>
  );
}
