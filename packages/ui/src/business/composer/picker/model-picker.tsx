/** 模型选择器：弹出层里按 provider 分组，条目带上下文说明 */

import { cn } from "cn";
import type { TFunction } from "i18next";
import { Check, Cpu } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../../base/badge";
import { useModelNames } from "../../../hooks/store/use-model-names";
import type { CatalogModel, CatalogProvider } from "../../../types";
import {
  PICKER_TRIGGER_CLASS,
  PICKER_TRIGGER_LABEL_CLASS,
  usePickerCloseFocus,
} from "./picker-options";

type ModelPickerProps = {
  providers: CatalogProvider[];
  /** 当前生效的 "provider/model" */
  value: string;
  disabled?: boolean;
  /** 弹层关掉后把焦点交给谁（输入区传编辑器）；点在别处时不会调它 */
  onRefocus?: () => void;
  /** 受控打开（`/models` 命令从外部唤起）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (model: string) => void;
};

/** 条目说明：上下文与输出上限、是否支持思考，用于区分同名模型 */
const describeModel = (model: CatalogModel, t: TFunction): string => {
  const parts: string[] = [];
  if (model.contextWindow) parts.push(t("{{n}} 上下文", { n: model.contextWindow }));
  if (model.maxTokens) parts.push(t("{{n}} 输出", { n: model.maxTokens }));
  if (model.reasoning) parts.push(t("思考"));
  return parts.join(" · ");
};

export function ModelPicker({
  providers,
  value,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onRefocus,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const names = useModelNames();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const visible = open ?? internalOpen;
  const closeFocus = usePickerCloseFocus(onRefocus);

  const setOpen = (next: boolean): void => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const groups = providers.filter((provider) => provider.models.length > 0);

  return (
    <Popover.Root open={visible} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" className={PICKER_TRIGGER_CLASS} title={t("切换模型")}>
          <Cpu />
          <span className={cn(PICKER_TRIGGER_LABEL_CLASS, "max-w-48 truncate")}>
            {value ? names.refLabel(value) : t("选择模型")}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          {...closeFocus}
          className={cn(
            "z-50 w-80 rounded-xl bg-popover shadow-popover ring-1 ring-border-strong outline-none",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          <div className="max-h-72 overflow-y-auto p-1">
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-foreground-subtle">
                {t("没有可选的模型")}
              </p>
            ) : null}

            {groups.map((provider) => (
              <div key={provider.id} className="py-0.5">
                <div className="px-2 py-1 text-xs text-foreground-subtle">{provider.name}</div>
                {provider.models.map((model) => {
                  const ref = `${provider.id}/${model.id}`;
                  const selected = ref === value;
                  return (
                    <button
                      key={ref}
                      type="button"
                      onClick={() => {
                        onSelect(ref);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none",
                        "transition-colors hover:bg-state-hover focus-visible:bg-muted",
                        selected && "bg-muted",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm">{model.name}</span>
                          {model.vision ? (
                            <Badge variant="secondary" className="px-1.5 text-xs">
                              {t("视觉")}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-foreground-subtle">
                          {describeModel(model, t)}
                        </span>
                      </span>
                      {selected ? <Check className="size-icon-sm shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
