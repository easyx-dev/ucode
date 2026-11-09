/** 助手模式选择器：切换当前会话的能力三元组（工具 / 权限 / 提示词） */
import {
  ClipboardList,
  Compass,
  Hammer,
  LayoutTemplate,
  type LucideIcon,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../base/dropdown-menu";
import { usePluginUi } from "../../../provider/plugin-host";
import { SESSION_MODES } from "../../../types";
import { pluginIconOf } from "../../../utils/plugin-icon";
import { modeDescription, modeLabel } from "./mode";
import {
  PICKER_TRIGGER_CLASS,
  type PickerOption,
  PickerOptions,
  usePickerCloseFocus,
} from "./picker-options";

type ModePickerProps = {
  value: string;
  disabled?: boolean;
  /** 弹层关掉后把焦点交给谁（输入区传编辑器）；点在别处时不会调它 */
  onRefocus?: () => void;
  /** 受控打开（`/mode` 命令从外部唤起）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (mode: string) => void;
};

/** 内置模式的图标：编码动手、计划列清单、问答只答疑；插件模式按插件给的图标名 */
const ICONS: Record<string, LucideIcon> = {
  build: Hammer,
  plan: ClipboardList,
  ask: MessageSquare,
};

/** 一条模式选项：内置的文案走 i18n，插件的文案由插件给 */
type ModeOption = { slug: string; label: string; description: string; icon: LucideIcon };

export function ModePicker({
  value,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onRefocus,
}: ModePickerProps) {
  const { t } = useTranslation();
  const pluginUi = usePluginUi();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const closeFocus = usePickerCloseFocus(onRefocus);

  /**
   * 模式列表 = 内置三个 + 插件贡献的主模式（设计就是后者）。
   * 插件模式排在内置之后：内置位置稳定，插件装了什么只影响尾部。
   */
  const modes: ModeOption[] = [
    ...SESSION_MODES.map((mode) => ({
      slug: mode,
      label: modeLabel(mode, t),
      description: modeDescription(mode, t),
      icon: ICONS[mode] ?? Compass,
    })),
    ...(pluginUi?.plugins ?? []).flatMap((bundle) =>
      bundle.modes.map((mode) => ({
        slug: mode.slug,
        label: mode.label,
        description: mode.description,
        icon: pluginIconOf(mode.icon, ICONS[mode.slug] ?? Compass),
      })),
    ),
  ];
  const labelOf = (mode: string): string => modes.find((item) => item.slug === mode)?.label ?? mode;

  return (
    <DropdownMenu
      open={open ?? internalOpen}
      onOpenChange={(next) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      {/* 模式是工具栏里唯一的全局状态：不带图标与下拉箭头，文案在任何容器宽度下都留着 */}
      <DropdownMenuTrigger className={PICKER_TRIGGER_CLASS} title={t("模式")} disabled={disabled}>
        <span>{labelOf(value)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72" {...closeFocus}>
        <PickerOptions
          options={modes.map(
            (mode): PickerOption => ({
              value: mode.slug,
              label: mode.label,
              description: mode.description,
              icon: mode.icon,
            }),
          )}
          value={value}
          onSelect={onSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
