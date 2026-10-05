/** 权限档位选择器：只决定命中 `ask` 时弹审批还是自动放行，不改变工具集与 `deny` */
import { cn } from "cn";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../base/select";
import { permissionModeDescription, permissionModeLabel } from "../lib/permission";
import { PERMISSION_MODES, type PermissionMode } from "../lib/types";

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
    <Select
      value={value}
      open={open ?? internalOpen}
      onOpenChange={(next) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
      }}
      onValueChange={(next) => onSelect(next as PermissionMode)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "gap-1 rounded-md border-0 bg-transparent px-2 text-xs dark:bg-transparent dark:hover:bg-muted [&_svg]:size-3.5",
          isFull
            ? "text-warning hover:bg-warning/10 hover:text-warning"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        title={t("权限档位")}
      >
        <Icon />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_MODES.map((mode) => (
          <SelectItem key={mode} value={mode} title={permissionModeDescription(mode, t)}>
            {permissionModeLabel(mode, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
