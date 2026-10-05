/** pi 内置供应商目录：搜索并选中一个，即加入一条待填 key 的配置 */
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../base/collapsible";
import { Input } from "../../base/input";
import type { CatalogProvider } from "../../lib/types";

type ProviderCatalogProps = {
  catalog: CatalogProvider[];
  /** 配置里已存在的 provider id，用于标记「已加入」 */
  configuredIds: Set<string>;
  onPick: (providerId: string) => void;
};

export function ProviderCatalog({ catalog, configuredIds, onPick }: ProviderCatalogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const builtins = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter(
      (item) =>
        item.source === "builtin" &&
        (!needle ||
          item.id.includes(needle) ||
          item.name.toLowerCase().includes(needle) ||
          item.authName.toLowerCase().includes(needle)),
    );
  }, [catalog, query]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <ChevronRight
            className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          {t("接入内置供应商")}
          <span className="ml-auto text-xs text-muted-foreground">
            {t("{{n}} 个可选", { n: builtins.length })}
          </span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 space-y-2">
        <div className="relative">
          <Search
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索供应商，如 deepseek")}
          />
        </div>

        {builtins.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
            {t("没有匹配的供应商。")}
          </p>
        ) : null}

        <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {builtins.map((item) => {
            const configured = configuredIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                disabled={configured}
                onClick={() => onPick(item.id)}
                className="flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left ring-1 ring-foreground/10 transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60"
              >
                <span className="flex w-full items-center gap-1.5 text-sm">
                  {item.name}
                  {configured ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">{t("已加入")}</span>
                  ) : null}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {configured
                    ? t("{{n}} 个模型", { n: item.models.length })
                    : item.authName || item.id}
                </span>
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
