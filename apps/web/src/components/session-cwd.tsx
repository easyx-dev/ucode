/** 头部的工作目录展示，完整路径放在 tooltip 里 */
import { FolderOpen } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SessionCwd({ cwd }: { cwd: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="hidden items-center gap-1 text-[10px] text-muted-foreground lg:flex">
          <FolderOpen className="size-3" />
          <span className="max-w-40 truncate">{cwd}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{cwd}</TooltipContent>
    </Tooltip>
  );
}
