/**
 * 资产编辑弹窗：新建或修改一条角色 / 技能 / 命令，编辑态可删除。
 *
 * 声明式弹层（同 MCP 表单）：它属于设置页的结构，随页面状态常驻；
 * 删除确认走函数式 `confirm`，由外层负责。
 */

import type {
  AssetDetail,
  AssetKind,
  AssetScope,
  AssetsSaveRequest,
  ThinkingLevel,
} from "@ucode/contracts";
import { THINKING_LEVELS } from "@ucode/contracts";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../base/dialog";
import { Input } from "../../../base/input";
import { Label } from "../../../base/label";
import { SegmentedControl, type SegmentedOption } from "../../../base/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../base/select";
import { Switch } from "../../../base/switch";
import { Textarea } from "../../../base/textarea";
import {
  type AssetFormState,
  assetToForm,
  canSubmitAssetForm,
  emptyAssetForm,
  formToSaveRequest,
  isAssetNameValid,
} from "./asset-form";

/** 「不指定」在 Select 里的取值：Radix 不允许空串当 Item 的值 */
const THINKING_UNSET = "none";

type FieldProps = {
  label: string;
  description?: string;
  children: ReactNode;
};

/**
 * 字段组：`id` 与 `aria-describedby` 由这里生成后注入控件。
 * 对 `Input` / `Textarea` 这类原生控件有效；Radix 的 `Select` 与 `SegmentedControl` 不吃这些属性，
 * 它们各自带可访问名（前者显式 `aria-label`，后者是 `sr-only` 的 legend）。
 */
function Field({ label, description, children }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        ...(descriptionId ? { "aria-describedby": descriptionId } : {}),
      })
    : children;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-foreground-subtle">
        {label}
      </Label>
      {control}
      {description ? (
        <p id={descriptionId} className="text-xs text-foreground-subtle">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** 弹窗标题里出现的中文都在 `t()` 内，便于 i18n 校验扫到 */
function useAssetDialogTitle(kind: AssetKind, isNew: boolean): string {
  const { t } = useTranslation();
  if (kind === "agent") return isNew ? t("新建角色") : t("编辑角色");
  if (kind === "skill") return isNew ? t("新建技能") : t("编辑技能");
  return isNew ? t("新建命令") : t("编辑命令");
}

function useAssetNameHint(kind: AssetKind): string {
  const { t } = useTranslation();
  if (kind === "agent") return t("小写字母开头，只能用字母、数字与连字符；它也是文件名。");
  if (kind === "skill") return t("小写字母或数字，单词之间用单个连字符；它也是技能目录名。");
  return t("小写字母或数字开头，只能用字母、数字与连字符；调用时写作 /名字。");
}

type AssetFormDialogProps = {
  kind: AssetKind;
  /** 为空表示新建 */
  detail: AssetDetail | null;
  /** 有工作目录时才允许落到项目档 */
  projectAvailable: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: AssetsSaveRequest) => Promise<boolean>;
  onDelete: (target: { name: string; path: string }) => void;
};

export function AssetFormDialog({
  kind,
  detail,
  projectAvailable,
  onOpenChange,
  onSubmit,
  onDelete,
}: AssetFormDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AssetFormState>(() =>
    detail ? assetToForm(detail) : emptyAssetForm(),
  );
  const [saving, setSaving] = useState(false);

  const isNew = detail === null;
  const title = useAssetDialogTitle(kind, isNew);
  const nameHint = useAssetNameHint(kind);
  const patch = (next: Partial<AssetFormState>) => setForm((prev) => ({ ...prev, ...next }));
  const valid = canSubmitAssetForm(kind, form, isNew);

  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await onSubmit(formToSaveRequest(kind, form, detail?.extraLines ?? []));
      if (saved) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const scopeOptions = (
    projectAvailable
      ? [
          { value: "global", label: t("全局（所有会话）") },
          { value: "project", label: t("当前项目") },
        ]
      : [{ value: "global", label: t("全局（所有会话）") }]
  ) satisfies ReadonlyArray<SegmentedOption<AssetScope>>;

  const modeOptions = [
    { value: "subagent", label: t("子智能体") },
    { value: "primary", label: t("主模式") },
    { value: "all", label: t("两者皆可") },
  ] satisfies ReadonlyArray<SegmentedOption<"primary" | "subagent" | "all">>;

  const description = isNew
    ? t("新建后写入磁盘，改动在下一个新会话生效。")
    : t("字段改动直接覆盖原文件，未建模的 frontmatter 行原样保留。");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <Field label={t("名称")} description={nameHint}>
            <Input
              value={form.name}
              disabled={!isNew}
              placeholder={kind === "command" ? "review-diff" : "code-reviewer"}
              aria-invalid={isNew && form.name.length > 0 && !isAssetNameValid(kind, form.name)}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          {isNew ? (
            <Field
              label={t("保存位置")}
              description={
                projectAvailable
                  ? t("项目档只对当前项目生效，同名时压过全局档。")
                  : t("当前没有工作目录，只能存到全局档。")
              }
            >
              <SegmentedControl
                label={t("保存位置")}
                value={form.scope}
                options={scopeOptions}
                onChange={(value) => patch({ scope: value })}
              />
            </Field>
          ) : (
            <p className="font-mono text-xs break-all text-foreground-subtle">{detail?.path}</p>
          )}

          {kind === "agent" ? (
            <>
              <Field label={t("展示名")} description={t("留空即用文件名。")}>
                <Input
                  value={form.label}
                  onChange={(event) => patch({ label: event.target.value })}
                />
              </Field>
              <Field
                label={t("说明")}
                description={t("写进角色选择器与 subagent 工具的描述，模型按它挑选。")}
              >
                <Input
                  value={form.description}
                  onChange={(event) => patch({ description: event.target.value })}
                />
              </Field>
              <Field
                label={t("类别")}
                description={t(
                  "主模式可作会话模式（与 build / plan / ask 并列），子智能体由 subagent 工具委派。",
                )}
              >
                <SegmentedControl
                  label={t("类别")}
                  value={form.mode}
                  options={modeOptions}
                  onChange={(value) => patch({ mode: value })}
                />
              </Field>
              <Field
                label={t("工具")}
                description={t(
                  "逗号或换行分隔；留空即继承父会话（子角色）或用默认工具集（主模式）。",
                )}
              >
                <Input
                  value={form.toolsText}
                  placeholder="read, grep, find, ls"
                  onChange={(event) => patch({ toolsText: event.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("模型")} description={t("留空即继承父会话。")}>
                  <Input
                    value={form.model}
                    onChange={(event) => patch({ model: event.target.value })}
                  />
                </Field>
                <Field label={t("思考档位")} description={t("只对主模式有效。")}>
                  <Select
                    value={form.thinking === "" ? THINKING_UNSET : form.thinking}
                    onValueChange={(value) =>
                      patch({ thinking: value === THINKING_UNSET ? "" : (value as ThinkingLevel) })
                    }
                  >
                    <SelectTrigger className="w-full" aria-label={t("思考档位")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={THINKING_UNSET}>{t("不指定")}</SelectItem>
                      {THINKING_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium">{t("列进工具描述")}</div>
                  <p className="text-xs text-foreground-subtle">
                    {t("关掉后仍可按名字调用，只是模型看不到它。")}
                  </p>
                </div>
                <Switch
                  checked={form.advertise}
                  aria-label={t("列进工具描述")}
                  onCheckedChange={(checked) => patch({ advertise: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium">{t("从角色选择器里隐藏")}</div>
                  <p className="text-xs text-foreground-subtle">
                    {t("只对主模式有效；隐藏后仍可按名字使用。")}
                  </p>
                </div>
                <Switch
                  checked={form.hidden}
                  aria-label={t("从角色选择器里隐藏")}
                  onCheckedChange={(checked) => patch({ hidden: checked })}
                />
              </div>
            </>
          ) : null}

          {kind === "command" ? (
            <>
              <Field label={t("说明")} description={t("留空即取正文首行；显示在 / 菜单里。")}>
                <Input
                  value={form.description}
                  onChange={(event) => patch({ description: event.target.value })}
                />
              </Field>
              <Field
                label={t("参数提示")}
                description={t("如 [focus]；显示在 / 菜单的命令名后面。")}
              >
                <Input
                  value={form.argumentHint}
                  onChange={(event) => patch({ argumentHint: event.target.value })}
                />
              </Field>
            </>
          ) : null}

          {kind === "skill" ? (
            <Field
              label={t("说明")}
              description={t("必填：模型按它判断何时用这个技能，缺了整条不会被装载。")}
            >
              <Input
                value={form.description}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </Field>
          ) : null}

          <Field
            label={kind === "command" ? t("命令正文") : t("提示词正文")}
            description={
              kind === "command"
                ? t("用户输入 / 名字 后，这段文字会替换掉命令本身；$1、$@ 可用参数。")
                : t("写给模型的指令本身。")
            }
          >
            <Textarea
              rows={kind === "command" ? 8 : 12}
              value={form.body}
              onChange={(event) => patch({ body: event.target.value })}
            />
          </Field>
        </div>

        <DialogFooter className="sm:justify-between">
          {detail ? (
            <Button
              variant="destructive"
              type="button"
              disabled={saving}
              onClick={() => onDelete({ name: detail.name, path: detail.path })}
            >
              {t("删除")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("取消")}
            </Button>
            <Button onClick={() => void submit()} disabled={saving || !valid}>
              {t("保存")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
