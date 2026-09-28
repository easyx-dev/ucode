import { CheckCircle2, ChevronRight, CircleDashed, TriangleAlert, Wrench } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type ToolCallCardProps = {
  name: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
  running?: boolean;
};

export function ToolCallCard({ name, args, result, isError, running }: ToolCallCardProps) {
  const hasBody = args !== undefined || (result !== undefined && result !== "");

  return (
    <Collapsible className="my-2 rounded-lg border bg-muted/40">
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
              执行中
            </>
          ) : isError ? (
            <>
              <TriangleAlert className="size-3 text-destructive" />
              失败
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3" />
              完成
            </>
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 border-t px-3 py-2">
          {args !== undefined ? (
            <pre className="max-h-48 overflow-auto rounded bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(args, null, 2)}
            </pre>
          ) : null}
          {result !== undefined && result !== "" ? (
            <pre className="max-h-72 overflow-auto rounded bg-background/70 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {result}
            </pre>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
