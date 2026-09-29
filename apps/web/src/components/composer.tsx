/** 输入区：白卡容器，顶部上下文行 + 无边框输入 + 底部工具栏（模型 / 思考档位 / 发送） */
import { ArrowUp, FolderOpen, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { ThinkingPicker } from "@/components/thinking-picker";
import { Button } from "@/components/ui/button";
import type { CatalogProvider, ThinkingLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

type ComposerProps = {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  /** 空对话时展示的建议 chips，点击填入输入框 */
  suggestions?: readonly string[];
  /** 会话工作目录，展示在顶部上下文行 */
  cwd?: string;
  providers: CatalogProvider[];
  /** 当前生效的 "provider/model" */
  model: string;
  thinkingLevel: ThinkingLevel;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
};

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  suggestions,
  cwd,
  providers,
  model,
  thinkingLevel,
  onSelectModel,
  onSelectThinkingLevel,
}: ComposerProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    setValue("");
    onSend(text);
  }, [disabled, onSend, streaming, value]);

  // 随内容撑高，封顶 220px 后交给内部滚动
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [value]);

  const fill = (text: string): void => {
    setValue(text);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {suggestions && suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => fill(text)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            "rounded-xl bg-popover ring-1 ring-foreground/10 transition-shadow",
            "focus-within:ring-2 focus-within:ring-ring/40",
            disabled && "opacity-60",
          )}
        >
          {cwd ? (
            <div className="flex items-center gap-1.5 px-3 pt-2.5 text-xs text-muted-foreground">
              <FolderOpen className="size-3.5 shrink-0" />
              <span className="truncate">{cwd}</span>
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={disabled ? t("先新建一个会话") : t("输入消息占位")}
            className="max-h-[220px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            {providers.length > 0 ? (
              <ModelPicker
                providers={providers}
                value={model}
                disabled={disabled}
                onSelect={onSelectModel}
              />
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              <ThinkingPicker
                value={thinkingLevel}
                disabled={disabled}
                onSelect={onSelectThinkingLevel}
              />

              {streaming ? (
                <Button size="icon" variant="outline" onClick={onStop} title={t("停止生成")}>
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={submit}
                  disabled={disabled || value.trim().length === 0}
                  title={t("发送")}
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
