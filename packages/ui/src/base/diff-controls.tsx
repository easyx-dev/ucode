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

/**
 * 工具条那一行的容器查询锚点：控件按**这一行**的宽度收起文案，调用方把它挂在那一行上。
 *
 * 必须具名。匿名的 `@[…]` 匹配最近的任意容器，而改动卡片（`chat/tool/tool-call`）外面就是消息区那层
 * `@container`，于是「窄了就收文字」会连带作用到卡片上——那里没有文案，只剩两枚不好认的图标。
 */
export const DIFF_TOOLBAR_CONTAINER_CLASS = "@container/diff-toolbar";

/**
 * 分段控件里的文案：容器窄于阈值就整条收起，只留图标。
 *
 * 这组控件是工具条上最宽的一块（带文字约 110px，窄屏上与路径、增删计数争的就是它）。
 * 收文字写成 `@max-…:sr-only` 而不是基础档 `sr-only` + 宽处 `not-sr-only`：没有这个具名容器的地方
 * （改动卡片）匹配不上，文案照常显示；反过来写，那种地方会被永久藏掉。
 * 用 `sr-only` 而不是 `hidden`：单选钮的可访问名来自这段文案（见 `base/segmented-control`）。
 */
const MODE_LABEL_CLASS = "@max-[30rem]/diff-toolbar:sr-only";

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
          {
            value: "unified",
            label: t("统一"),
            icon: <AlignLeft className="size-icon-sm" />,
            labelClassName: MODE_LABEL_CLASS,
          },
          {
            value: "split",
            label: t("双栏"),
            icon: <Columns2 className="size-icon-sm" />,
            labelClassName: MODE_LABEL_CLASS,
          },
        ]}
        onChange={onSelectMode}
      />
      <IconButton label={t("自动换行")} pressed={wrap} onClick={onToggleWrap}>
        <WrapText className="size-icon-base" />
      </IconButton>
    </div>
  );
}
