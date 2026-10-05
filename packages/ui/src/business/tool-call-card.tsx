import { cn } from "cn";
import { CheckCircle2, ChevronRight, CircleDashed, TriangleAlert, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../base/collapsible";

type ToolCallCardProps = {
  name: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
  running?: boolean;
  /** 额外内容（如子智能体的内联进度），渲染在参数 / 结果下方 */
  children?: ReactNode;
};

export function ToolCallCard({
  name,
  args,
  result,
  isError,
  running,
  children,
}: ToolCallCardProps) {
  const { t } = useTranslation();
  const hasBody =
    args !== undefined || (result !== undefined && result !== "") || Boolean(children);

  return (
    <Collapsible className="my-2 rounded-lg bg-muted/50 ring-1 ring-foreground/10">
      <CollapsibleTrigger
        className="group flex w-full items-center gap-2 px-3 py-2 text-left"
        disabled={!hasBody}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            hasBody && "group-data-[state=open]:rotate-90",
            !hasBody && "invisible",
          )}
        />
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{name}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {running ? (
            <>
              <CircleDashed className="size-3 animate-spin" />
              {t("执行中")}
            </>
          ) : isError ? (
            <>
              <TriangleAlert className="size-3 text-destructive" />
              {t("失败")}
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3" />
              {t("完成")}
            </>
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 border-t border-border px-3 py-2">
          {args !== undefined ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-card p-2 font-mono text-xs leading-relaxed">
              {JSON.stringify(args, null, 2)}
            </pre>
          ) : null}
          {result !== undefined && result !== "" ? (
            <pre className="max-h-72 overflow-auto rounded-md bg-card p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {result}
            </pre>
          ) : null}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
