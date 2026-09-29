/**
 * 推理等级映射：按需为某档指定厂商取值。
 * 行不存在 = 用厂商默认；行存在且填值 = 映射到该值；行存在但留空 = 该档不支持。
 */
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DraftModel } from "@/lib/config-draft";
import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/types";

/** 档位的中文名，仅用于界面；写进配置的始终是 pi 的英文档位 */
const LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
};

type ModelThinkingLevelsProps = {
  model: DraftModel;
  onChange: (patch: Partial<DraftModel>) => void;
};

export function ModelThinkingLevels({ model, onChange }: ModelThinkingLevelsProps) {
  const mapped = model.thinkingLevelMap;
  const rows = THINKING_LEVELS.filter((level) => level in mapped);
  const unused = THINKING_LEVELS.filter((level) => !(level in mapped));

  const commit = (next: Partial<Record<ThinkingLevel, string | null>>) =>
    onChange({ thinkingLevelMap: next });

  const addRow = () => {
    const level = unused[0];
    if (level) commit({ ...mapped, [level]: null });
  };

  const changeLevel = (from: ThinkingLevel, to: ThinkingLevel) => {
    const { [from]: value, ...rest } = mapped;
    commit({ ...rest, [to]: value ?? null });
  };

  const changeValue = (level: ThinkingLevel, text: string) => {
    commit({ ...mapped, [level]: text.trim() ? text : null });
  };

  const removeRow = (level: ThinkingLevel) => {
    const { [level]: _removed, ...rest } = mapped;
    commit(rest);
  };

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">推理等级映射</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px]"
          onClick={addRow}
          disabled={unused.length === 0}
        >
          <Plus className="size-3" />
          添加等级
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          未指定时按厂商默认处理，pi 的 7 档都能用。
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((level) => (
            <div key={level} className="flex items-center gap-2">
              <Select
                value={level}
                onValueChange={(value) => changeLevel(level, value as ThinkingLevel)}
              >
                <SelectTrigger className="h-7 w-24 text-xs" aria-label="推理等级">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[level, ...unused].map((option) => (
                    <SelectItem key={option} value={option}>
                      {LEVEL_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                className="h-7 flex-1 text-xs"
                value={mapped[level] ?? ""}
                placeholder="厂商取值；留空 = 该档不支持"
                aria-label={`${LEVEL_LABELS[level]}档的厂商取值`}
                onChange={(event) => changeValue(level, event.target.value)}
              />

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeRow(level)}
                title="删除该档映射"
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
