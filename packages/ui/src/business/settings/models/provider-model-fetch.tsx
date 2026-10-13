/**
 * 「拉取模型列表」的两块 UI：动作按钮与结果列表。
 *
 * 请求状态由调用方持有的 useProviderModelFetch 提供——按钮在区块标题行、结果在列表上方，
 * 两处分开渲染，状态不能各持一份。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../base/badge";
import { Button } from "../../../base/button";
import { Spinner } from "../../../base/spinner";
import type {
  ModelCapabilitySource,
  ProviderModelSuggestion,
  ProviderModelsResponse,
} from "../../../types";
import type { DraftProvider } from "../config-draft";

/** 能力取值来源 → 中文短标签；逐项列出，文案 key 随来源穷举 */
const sourceLabel = (source: ModelCapabilitySource, t: TFunction): string => {
  switch (source) {
    case "configured":
      return t("已配置");
    case "upstream":
      return t("上游");
    case "catalog":
      return t("内置目录");
    case "heuristic":
      return t("按 id 推断");
    case "default":
      return t("按默认值");
  }
};

/** 能力标签：思考 / 视觉用同一套词汇，与模型选择器保持一致 */
function CapabilityBadges({ suggestion }: { suggestion: ProviderModelSuggestion }) {
  const { t } = useTranslation();

  return (
    <>
      {suggestion.reasoning ? (
        <Badge variant="secondary" className="px-1.5 text-xs">
          {t("思考")}
        </Badge>
      ) : null}
      {suggestion.vision ? (
        <Badge variant="secondary" className="px-1.5 text-xs">
          {t("视觉")}
        </Badge>
      ) : null}
      {suggestion.configured ? (
        <Badge variant="outline" className="px-1.5 text-xs">
          {t("已在配置里")}
        </Badge>
      ) : null}
    </>
  );
}

function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: ProviderModelSuggestion;
  onSelect: (suggestion: ProviderModelSuggestion) => void;
}) {
  const { t } = useTranslation();
  const capability = [
    t("{{n}} 上下文", { n: suggestion.contextWindow }),
    t("{{n}} 输出", { n: suggestion.maxTokens }),
    t("来源：{{source}}", { source: sourceLabel(suggestion.capabilitySource, t) }),
  ].join(" · ");

  return (
    <button
      type="button"
      onClick={() => onSelect(suggestion)}
      title={t("填入这条模型")}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none",
        "transition-colors hover:bg-state-hover focus-visible:bg-muted",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{suggestion.name}</span>
          <CapabilityBadges suggestion={suggestion} />
        </span>
        <span className="block truncate text-xs text-foreground-subtle">
          {suggestion.name === suggestion.id ? capability : `${suggestion.id} · ${capability}`}
        </span>
      </span>
    </button>
  );
}

type ModelFetchButtonProps = {
  provider: DraftProvider;
  fetching: boolean;
  onFetch: (provider: DraftProvider) => Promise<void>;
};

export function ModelFetchButton({ provider, fetching, onFetch }: ModelFetchButtonProps) {
  const { t } = useTranslation();

  return (
    <Button variant="outline" size="sm" disabled={fetching} onClick={() => void onFetch(provider)}>
      {fetching ? <Spinner className="size-icon-sm" /> : <Download className="size-icon-sm" />}
      {fetching ? t("拉取中…") : t("拉取模型列表")}
    </Button>
  );
}

type ModelFetchResultProps = {
  result: ProviderModelsResponse;
  onSelect: (suggestion: ProviderModelSuggestion) => void;
  onDiscard: () => void;
};

export function ModelFetchResult({ result, onSelect, onDiscard }: ModelFetchResultProps) {
  const { t } = useTranslation();
  const count = result.models.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-foreground-subtle" title={result.url}>
          {t("已拉取 {{n}} 个模型 · {{latency}}ms", { n: count, latency: result.latencyMs })}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={onDiscard}>
          {t("收起")}
        </Button>
      </div>

      {result.truncated ? (
        <p className="text-xs text-foreground-subtle">
          {t("上游返回的条数超过上限，只显示前 {{n}} 条。", { n: count })}
        </p>
      ) : null}

      {count === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-foreground-subtle">
          {t("上游没有返回任何模型，请确认端点是否兼容 /models。")}
        </p>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg p-1 ring-1 ring-border-strong">
          {result.models.map((suggestion) => (
            <SuggestionRow key={suggestion.id} suggestion={suggestion} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
