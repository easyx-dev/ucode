/** MCP 服务器编辑弹窗：新增 / 修改一个服务器，编辑态可删除 */
import type { McpServerView, McpUpsertRequest } from "@ucode/contracts";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedControl, type SegmentedOption } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  emptyMcpForm,
  formToRequest,
  isMcpFormValid,
  type McpFormState,
  serverToForm,
} from "@/lib/mcp-form";
import { MCP_EXPOSURES, MCP_TRANSPORTS, type McpExposure, type McpTransport } from "@/lib/types";

/** 多行输入：与 `Input` 同一套 token，只是高度可随内容增高 */
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type FieldProps = {
  label: string;
  description?: string;
  children: ReactNode;
};

function Field({ label, description, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

type McpServerFormDialogProps = {
  /** 为空表示新增 */
  initial: McpServerView | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: McpUpsertRequest) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
};

export function McpServerFormDialog({
  initial,
  onOpenChange,
  onSubmit,
  onDelete,
}: McpServerFormDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<McpFormState>(() =>
    initial ? serverToForm(initial) : emptyMcpForm(),
  );
  const [saving, setSaving] = useState(false);

  const patch = (next: Partial<McpFormState>) => setForm((prev) => ({ ...prev, ...next }));
  const valid = isMcpFormValid(form);

  const submit = async () => {
    setSaving(true);
    try {
      if (await onSubmit(formToRequest(form))) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    setSaving(true);
    try {
      if (await onDelete(initial.name)) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const enabledOptions = [
    { value: "on", label: t("启用") },
    { value: "off", label: t("停用") },
  ] as const satisfies ReadonlyArray<SegmentedOption<"on" | "off">>;

  // 暴露方式 → 文案；渲染顺序由 MCP_EXPOSURES 决定
  const exposureLabels = {
    codemode: t("脚本调用"),
    "codemode-deferred": t("脚本内检索"),
    deferred: t("检索后调用"),
    direct: t("直接调用"),
    hidden: t("隐藏"),
  } satisfies Record<McpExposure, string>;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? t("编辑 MCP 服务器") : t("添加 MCP 服务器")}</DialogTitle>
          <DialogDescription>{t("MCP.表单说明")}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <Field label={t("服务器名")} description={t("服务器名.说明")}>
            <Input
              value={form.name}
              disabled={Boolean(initial)}
              placeholder="filesystem"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("传输方式")}>
              <Select
                value={form.type}
                onValueChange={(value) => patch({ type: value as McpTransport })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_TRANSPORTS.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type === "stdio" ? t("本地进程") : t("HTTP 端点")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={t("暴露方式")} description={t("暴露方式.说明")}>
              <Select
                value={form.exposure}
                onValueChange={(value) => patch({ exposure: value as McpExposure })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_EXPOSURES.map((exposure) => (
                    <SelectItem key={exposure} value={exposure}>
                      {exposureLabels[exposure]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={t("超时")} description={t("超时.说明")}>
            <Input
              type="number"
              min={1}
              value={form.timeout}
              placeholder="60"
              onChange={(event) => patch({ timeout: event.target.value })}
            />
          </Field>

          {form.type === "stdio" ? (
            <>
              <Field label={t("启动命令")} description={t("启动命令.说明")}>
                <Input
                  value={form.command}
                  placeholder="npx"
                  onChange={(event) => patch({ command: event.target.value })}
                />
              </Field>
              <Field label={t("参数")} description={t("参数.说明")}>
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={3}
                  value={form.argsText}
                  onChange={(event) => patch({ argsText: event.target.value })}
                />
              </Field>
              <Field label={t("环境变量")} description={t("环境变量.说明")}>
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={3}
                  value={form.envText}
                  placeholder="API_KEY=…"
                  onChange={(event) => patch({ envText: event.target.value })}
                />
              </Field>
              <Field label={t("工作目录")} description={t("工作目录.说明")}>
                <Input value={form.cwd} onChange={(event) => patch({ cwd: event.target.value })} />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("端点地址")} description={t("端点地址.说明")}>
                <Input
                  value={form.url}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => patch({ url: event.target.value })}
                />
              </Field>
              <Field label={t("请求头")} description={t("请求头.说明")}>
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={3}
                  value={form.headersText}
                  placeholder="Authorization=Bearer …"
                  onChange={(event) => patch({ headersText: event.target.value })}
                />
              </Field>
            </>
          )}

          <Field label={t("状态")}>
            <SegmentedControl
              label={t("状态")}
              value={form.enabled ? "on" : "off"}
              options={enabledOptions}
              onChange={(value) => patch({ enabled: value === "on" })}
            />
          </Field>
        </div>

        <DialogFooter className="sm:justify-between">
          {initial ? (
            <Button
              variant="destructive"
              onClick={() => void remove()}
              disabled={saving}
              type="button"
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
