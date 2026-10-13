/** MCP 服务器编辑弹窗：新增 / 修改一个服务器，编辑态可删除 */
import type { McpServerView, McpUpsertRequest } from "@ucode/contracts";
import { type ReactNode, useState } from "react";
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
import { MCP_EXPOSURES, MCP_TRANSPORTS, type McpExposure, type McpTransport } from "../../../types";
import {
  emptyMcpForm,
  formToRequest,
  isMcpFormValid,
  type McpFormState,
  serverToForm,
} from "./mcp-form";

/** 多行输入：与 `Input` 同一套 token，只是高度可随内容增高 */
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-foreground-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

type FieldProps = {
  label: string;
  description?: string;
  children: ReactNode;
};

function Field({ label, description, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-foreground-subtle">{label}</Label>
      {children}
      {description ? <p className="text-xs text-foreground-subtle">{description}</p> : null}
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
    deferred: t("检索后调用"),
    direct: t("直接调用"),
    hidden: t("隐藏"),
  } satisfies Record<McpExposure, string>;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? t("编辑 MCP 服务器") : t("添加 MCP 服务器")}</DialogTitle>
          <DialogDescription>
            {t("stdio 走本地命令，http 走远端地址；环境变量与请求头一行一条 KEY=VALUE。")}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <Field
            label={t("服务器名")}
            description={t(
              "用于拼出 mcp__<服务器名>__<工具名>；名字里的非字母、数字、下划线字符在工具名中会转为 _。只允许字母、数字与 . _ -。",
            )}
          >
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

            <Field
              label={t("暴露方式")}
              description={t(
                "脚本调用经 codemode 使用、不声明给模型、由脚本按需查找；检索后调用经 tool_search 加载后再声明给模型；直接调用会立即声明给模型。",
              )}
            >
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

          <Field label={t("超时")} description={t("单次请求的超时秒数；留空即用默认值（60 秒）。")}>
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
              <Field
                label={t("启动命令")}
                description={t("启动 MCP 服务器的可执行文件，如 npx / uvx。")}
              >
                <Input
                  value={form.command}
                  placeholder="npx"
                  onChange={(event) => patch({ command: event.target.value })}
                />
              </Field>
              <Field label={t("参数")} description={t("传给启动命令的参数，一行一个。")}>
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={3}
                  value={form.argsText}
                  onChange={(event) => patch({ argsText: event.target.value })}
                />
              </Field>
              <Field
                label={t("环境变量")}
                description={t("传给子进程的环境变量，值可写 ${NAME} 引用环境变量。")}
              >
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={3}
                  value={form.envText}
                  placeholder="API_KEY=…"
                  onChange={(event) => patch({ envText: event.target.value })}
                />
              </Field>
              <Field
                label={t("工作目录")}
                description={t(
                  "服务器的工作目录，相对路径按会话工作目录解析；留空即用会话工作目录。",
                )}
              >
                <Input value={form.cwd} onChange={(event) => patch({ cwd: event.target.value })} />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("端点地址")} description={t("MCP 服务器的 HTTP 端点。")}>
                <Input
                  value={form.url}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => patch({ url: event.target.value })}
                />
              </Field>
              <Field
                label={t("请求头")}
                description={t("请求时携带的 HTTP 头，值可写 ${NAME} 引用环境变量。")}
              >
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
