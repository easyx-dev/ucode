/**
 * diff 的展示控件：统一 / 双栏切换与自动换行开关（单文件标签与堆叠视图共用）。
 *
 * 「全部展开 / 收起」不在这里——它要拿到某一份 diff 的库实例，属于各视图自己的事。
 */
import { AlignLeft, Columns2, WrapText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../../base/button";
import { SegmentedControl } from "../../../base/segmented-control";
import type { DiffMode } from "./diff-prefs";

/** 两个控件都不可压缩：工具条窄时宁可挤掉标题，也不要让它们折行 */
export function DiffDisplayControls({
  mode,
  wrap,
  onSelectMode,
  onToggleWrap,
}: {
  mode: DiffMode;
  wrap: boolean;
  onSelectMode: (mode: DiffMode) => void;
  onToggleWrap: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <SegmentedControl
        label={t("展示方式")}
        value={mode}
        options={[
          { value: "unified", label: t("统一"), icon: <AlignLeft className="size-icon-sm" /> },
          { value: "split", label: t("双栏"), icon: <Columns2 className="size-icon-sm" /> },
        ]}
        onChange={onSelectMode}
      />
      <IconButton label={t("自动换行")} pressed={wrap} onClick={onToggleWrap}>
        <WrapText className="size-icon-base" />
      </IconButton>
    </div>
  );
}
