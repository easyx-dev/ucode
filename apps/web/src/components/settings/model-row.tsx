/** 模型设置里的一行模型：id / 显示名 / 上下文字段 / 输出上限 / 是否支持思考 */
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DraftModel } from "@/lib/config-draft";

type ModelRowProps = {
  model: DraftModel;
  onChange: (patch: Partial<DraftModel>) => void;
  onRemove: () => void;
};

export function ModelRow({ model, onChange, onRemove }: ModelRowProps) {
  return (
    <div className="grid items-end gap-2 sm:grid-cols-12">
      <div className="space-y-1.5 sm:col-span-3">
        <Label className="text-[11px] text-muted-foreground">模型 id</Label>
        <Input
          value={model.id}
          onChange={(event) => onChange({ id: event.target.value })}
          placeholder="deepseek-v4-flash"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-3">
        <Label className="text-[11px] text-muted-foreground">显示名</Label>
        <Input value={model.name} onChange={(event) => onChange({ name: event.target.value })} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">context</Label>
        <Input
          value={model.contextWindow}
          onChange={(event) => onChange({ contextWindow: event.target.value })}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">maxTokens</Label>
        <Input
          value={model.maxTokens}
          onChange={(event) => onChange({ maxTokens: event.target.value })}
        />
      </div>
      <label className="flex h-8 items-center gap-1.5 text-xs sm:col-span-1">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={model.reasoning}
          onChange={(event) => onChange({ reasoning: event.target.checked })}
        />
        think
      </label>
      <Button
        variant="ghost"
        size="icon-sm"
        className="sm:col-span-1"
        onClick={onRemove}
        title="删除模型"
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </div>
  );
}
