/**
 * diff 的展示控件：统一 / 双栏切换与自动换行开关。
 *
 * 工作台的 git 面板与消息流的改动卡片共用；「全部展开 / 收起」不在这里——它要拿到某一份 diff
 * 的库实例，属于各视图自己的事。控件本身不存偏好（`hooks/use-diff-prefs` 管那份状态）。
 */
import { cn } from "cn";
import { AlignLeft, Columns2, WrapText } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DiffMode } from "../hooks/use-diff-prefs";
import { IconButton } from "./button";
import { SegmentedControl } from "./segmented-control";

/** 两个控件都不可压缩：工具条窄时宁可挤掉标题，也不要让它们折行 */
export function DiffDisplayControls({
  mode,
  wrap,
  onSelectMode,
  onToggleWrap,
  className,
}: {
  mode: DiffMode;
  wrap: boolean;
  onSelectMode: (mode: DiffMode) => void;
  onToggleWrap: () => void;
  /** 调用方要自己控制显隐时挂在这一层（如改动卡片里悬停才现） */
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
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
