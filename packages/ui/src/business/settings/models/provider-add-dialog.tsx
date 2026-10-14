/** 添加供应商：从 pi 内置目录里搜索选中一个，或新建自定义供应商 */
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../base/dialog";
import { Empty } from "../../../base/empty";
import { InputSearch } from "../../../base/input";
import { Separator } from "../../../base/separator";
import type { CatalogProvider } from "../../../types";

type ProviderAddDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: CatalogProvider[];
  /** 配置里已存在的 provider id，用于标记「已加入」 */
  configuredIds: Set<string>;
  /** 选中一个内置供应商：插入草稿并关闭 */
  onSelect: (providerId: string) => void;
  /** 新建一条自定义供应商 */
  onAddCustom: () => void;
};

/** 目录过滤：id / 名称 / 鉴权名任一命中；自定义供应商不进这份候选 */
const matchCatalog = (catalog: CatalogProvider[], query: string): CatalogProvider[] => {
  const needle = query.trim().toLowerCase();
  return catalog.filter(
    (item) =>
      item.source === "builtin" &&
      (!needle ||
        item.id.includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        item.authName.toLowerCase().includes(needle)),
  );
};

function CatalogSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();

  return (
    <div className="shrink-0">
      <InputSearch
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("搜索供应商，如 deepseek")}
        className="pl-8"
      />
    </div>
  );
}

/** 目录里的可选项：已加入的置灰不可再选，点选即插入草稿 */
function CatalogList({
  providers,
  configuredIds,
  onSelect,
}: {
  providers: CatalogProvider[];
  configuredIds: Set<string>;
  onSelect: (providerId: string) => void;
}) {
  const { t } = useTranslation();

  if (providers.length === 0) {
    return (
      <Empty
        className="rounded-xl border border-dashed px-3 py-4"
        title={t("没有匹配的供应商。")}
      />
    );
  }

  return (
    <div className="grid gap-2 pr-1 sm:grid-cols-2">
      {providers.map((item) => {
        const configured = configuredIds.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            disabled={configured}
            onClick={() => onSelect(item.id)}
            className="flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left ring-1 ring-border-strong transition-colors hover:bg-state-hover disabled:cursor-default disabled:opacity-60"
          >
            <span className="flex w-full items-center gap-1.5 text-sm">
              {item.name}
              {configured ? (
                <span className="ml-auto text-xs text-foreground-subtle">{t("已加入")}</span>
              ) : null}
            </span>
            <span className="text-xs text-foreground-subtle">{item.authName || item.id}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ProviderAddDialog({
  open,
  onOpenChange,
  catalog,
  configuredIds,
  onSelect,
  onAddCustom,
}: ProviderAddDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  // 每次打开都是一次新的挑选，不保留上一次的搜索词
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const builtins = useMemo(() => matchCatalog(catalog, query), [catalog, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("添加供应商")}</DialogTitle>
          <DialogDescription>
            {t("内置目录里的供应商只需再填一把 key；pi 不认识的端点用自定义供应商。")}
          </DialogDescription>
        </DialogHeader>

        <CatalogSearch value={query} onChange={setQuery} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CatalogList providers={builtins} configuredIds={configuredIds} onSelect={onSelect} />
        </div>

        <Separator className="shrink-0" />
        <Button variant="outline" className="shrink-0 justify-start" onClick={onAddCustom}>
          <Plus className="size-icon-base" />
          {t("添加自定义供应商")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
