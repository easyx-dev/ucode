/**
 * 复制会话原始记录（JSONL）：内容要现取（可达几 MB），所以按钮自己去加载再复制。
 *
 * 与 `CopyAction` 同一套反馈：成功换对勾并保持片刻，失败保持原状并复位；失败原因由调用方提示
 * （记录过大、文件读不到这类话要说到，否则「复制出来是空的」看不出是失败）。
 */
import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../base/tooltip";
import { copyText } from "../lib/clipboard";

/** 复制成功后的提示时长；与 `CopyAction` 一致 */
const COPIED_HINT_MS = 1500;

type CopyTranscriptActionProps = {
  /** 取会话原始记录；失败时抛错由调用方提示 */
  load: () => Promise<string>;
};

type CopyState = "idle" | "loading" | "copied";

export function CopyTranscriptAction({ load }: CopyTranscriptActionProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setState("idle"), COPIED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const label =
    state === "copied" ? t("已复制") : state === "loading" ? t("复制中…") : t("复制会话记录");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={state === "loading"}
          title={label}
          onClick={() => {
            setState("loading");
            void load()
              .then((text) => copyText(text))
              .then((ok) => setState(ok ? "copied" : "idle"))
              .catch(() => setState("idle"));
          }}
        >
          {state === "loading" ? (
            <Loader2 className="size-icon-sm animate-spin" />
          ) : state === "copied" ? (
            <Check className="size-icon-sm" />
          ) : (
            <Copy className="size-icon-sm" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
