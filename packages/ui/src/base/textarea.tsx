/** 多行文本输入：与 Input 共用底座，高度可随内容增高（正文类字段用它） */
import { cn } from "cn";
import type * as React from "react";
import { INPUT_BASE_CLASS } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(INPUT_BASE_CLASS, "px-2.5 py-1.5 text-sm leading-relaxed", className)}
      {...props}
    />
  );
}

export { Textarea };
