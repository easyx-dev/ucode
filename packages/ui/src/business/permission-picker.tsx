/** 权限档位选择器：只决定命中 `ask` 时弹审批还是自动放行，不改变工具集与 `deny` */
import { cn } from "cn";
import { ChevronDown, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../base/dropdown-menu";
import { permissionModeDescription, permissionModeLabel } from "../lib/permission";
import { PERMISSION_MODES, type PermissionMode } from "../lib/types";
import { PICKER_TRIGGER_CLASS, type PickerOption, PickerOptions } from "./picker-options";

type PermissionPickerProps = {
  value: PermissionMode;
  disabled?: boolean;
  /** 受控打开（`/permission` 命令从外部唤起）；不传则内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (mode: PermissionMode) => void;
};

/** 档位对应的盾牌图标：越放行越警示 */
const ICONS: Record<PermissionMode, typeof Shield> = {
  default: Shield,
  auto: ShieldCheck,
  full: ShieldAlert,
};

export function PermissionPicker({
  value,
  disabled,
  open,
  onOpenChange,
  onSelect,
}: PermissionPickerProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const Icon = ICONS[value] ?? Shield;
  // 最放行档用 warning 色标记，提醒它已跳过越界审批（见 DESIGN.md 的权限标记）
  const isFull = value === "full";

  return (
    <DropdownMenu
      open={open ?? internalOpen}
      onOpenChange={(next) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      <DropdownMenuTrigger
        className={cn(
          PICKER_TRIGGER_CLASS,
          isFull ? "text-warning hover:bg-warning/10 hover:text-warning" : "hover:text-foreground",
        )}
        title={t("权限档位")}
        disabled={disabled}
      >
        <Icon />
        {permissionModeLabel(value, t)}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <PickerOptions
          options={PERMISSION_MODES.map(
            (mode): PickerOption => ({
              value: mode,
              label: permissionModeLabel(mode, t),
              description: permissionModeDescription(mode, t),
              icon: ICONS[mode] ?? Shield,
            }),
          )}
          value={value}
          onSelect={(next) => onSelect(next as PermissionMode)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
