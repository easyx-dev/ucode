import { cloneElement, isValidElement, type ReactNode, useEffect, useId, useState } from "react";
import { useAgentStore } from "../context.ts";
import {
  emptyProviderForm,
  type ProviderFormError,
  providerDriftNotice,
  providerSummaryLine,
  validateProviderForm,
} from "./model-config-format.ts";
import { Badge, Button, Modal, Spinner } from "./primitives.tsx";

/**
 * 模型配置窗口（F-5.3）。
 *
 * 对齐 zcode 的两处：输入区工具条上的**选择模型**（`ModelConfigSelect`），
 * 以及"管理模型"进入的**添加供应商**表单（`settings/model-provider-section`，
 * 字段为 Base URL / API Key / 模型 ID）。
 *
 * 为什么这个窗口是必需品而不是锦上添花：在此之前只有 CLI 的 `provider add`
 * 写得进配置，界面里只有一个"在已配好的模型里挑"的下拉框——全新用户看到的是
 * 空列表，而且没有任何入口告诉他"要先配一个端点"。这就是"缺少模型配置窗口"。
 */
export function ModelConfigDialog({ onClose }: { onClose: () => void }): ReactNode {
  const providers = useAgentStore((store) => store.providers);
  const loadProviders = useAgentStore((store) => store.loadProviders);
  const addProvider = useAgentStore((store) => store.addProvider);
  const removeProvider = useAgentStore((store) => store.removeProvider);
  const [form, setForm] = useState(emptyProviderForm());
  const [error, setError] = useState<ProviderFormError | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const submit = (): void => {
    const invalid = validateProviderForm(form);
    setError(invalid);
    if (invalid !== null) return;
    void addProvider({
      id: form.id.trim(),
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      ...(form.apiKey.trim() === "" ? {} : { apiKey: form.apiKey.trim() }),
      makeDefault,
    }).then(() => setForm(emptyProviderForm()));
  };

  return (
    <Modal title="模型配置">
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        <section>
          <h3 className="mb-1.5 text-xs font-medium text-[var(--color-content-muted)]">
            已配置的供应商
          </h3>
          {providers.loading && providers.providers.length === 0 && (
            <p className="flex items-center gap-2 text-xs text-[var(--color-content-muted)]">
              <Spinner /> 读取中…
            </p>
          )}
          {!providers.loading && providers.providers.length === 0 && (
            <p className="text-xs text-[var(--color-content-muted)]">
              还没有配置任何供应商。填下面的表单加一个，就会出现在模型选择器里。
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {providers.providers.map((provider) => {
              const drift = providerDriftNotice(provider);
              return (
                <div
                  key={provider.id}
                  className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{providerSummaryLine(provider)}</span>
                    {!provider.hasApiKey && <Badge tone="warn">无密钥</Badge>}
                    <Button
                      size="sm"
                      variant="danger"
                      className="ml-auto"
                      onClick={() => void removeProvider(provider.id)}
                    >
                      删除
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-content-muted)]">
                    模型：
                    {provider.models.length === 0
                      ? "（基座未解析出可用模型）"
                      : provider.models
                          .map((model) => `${model.id}${model.available ? "" : "（无凭据）"}`)
                          .join("、")}
                  </p>
                  {drift !== null && (
                    <p className="mt-1 text-[11px] text-[var(--color-warn)]">{drift}</p>
                  )}
                </div>
              );
            })}
          </div>
          {providers.configFile !== null && (
            <p className="mt-1.5 text-[10px] text-[var(--color-content-muted)]">
              写入 {providers.configFile}
            </p>
          )}
        </section>

        <section className="border-t border-[var(--color-border-subtle)] pt-3">
          <h3 className="mb-2 text-xs font-medium text-[var(--color-content-muted)]">添加供应商</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="供应商 id" error={error?.field === "id" ? error.message : undefined}>
              <input
                className={inputClass}
                placeholder="my-proxy"
                value={form.id}
                onChange={(event) => setForm({ ...form, id: event.target.value })}
              />
            </Field>
            <Field label="模型 ID" error={error?.field === "model" ? error.message : undefined}>
              <input
                className={inputClass}
                placeholder="deepseek-v4-flash"
                value={form.model}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
              />
            </Field>
          </div>
          <div className="mt-2">
            <Field
              label="Base URL"
              error={error?.field === "baseUrl" ? error.message : undefined}
              hint="OpenAI 兼容端点，通常以 /v1 结尾"
            >
              <input
                className={inputClass}
                placeholder="http://127.0.0.1:8080/v1"
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              />
            </Field>
          </div>
          <div className="mt-2">
            <Field label="API Key" hint="只写入本机数据层（0600），之后只回报有/无、不回读明文">
              <input
                className={inputClass}
                type="password"
                placeholder="sk-…"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              />
            </Field>
          </div>
          <p className="mt-2 text-[10px] text-[var(--color-content-muted)]">
            供应商 id 不要与基座内置供应商同名（如 openai / anthropic / deepseek / google）：
            内置模型目录会与它合并，实际发送的模型可能被换掉。写入后会立刻校验并告警。
          </p>
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-content-muted)]">
            <input
              type="checkbox"
              className="size-3"
              checked={makeDefault}
              onChange={(event) => setMakeDefault(event.target.checked)}
            />
            设为默认模型
          </label>
        </section>

        {providers.notice !== null && (
          <p className="rounded bg-[var(--color-surface-overlay)] px-2 py-1.5 text-[11px] text-[var(--color-content)]">
            {providers.notice}
          </p>
        )}
        {providers.error !== null && (
          <p className="rounded bg-[oklch(0.3_0.06_25)] px-2 py-1.5 text-[11px] text-[var(--color-danger)]">
            {providers.error}
          </p>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-3">
        <Button onClick={onClose}>关闭</Button>
        <Button variant="primary" disabled={providers.loading} onClick={submit}>
          {providers.loading ? "写入中…" : "添加供应商"}
        </Button>
      </div>
    </Modal>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}): ReactNode {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-[var(--color-content-muted)]">
        {label}
      </label>
      <FieldControl id={id}>{children}</FieldControl>
      {error !== undefined && (
        <span className="mt-1 block text-[10px] text-[var(--color-danger)]">{error}</span>
      )}
      {error === undefined && hint !== undefined && (
        <span className="mt-1 block text-[10px] text-[var(--color-content-muted)]">{hint}</span>
      )}
    </div>
  );
}

/**
 * 把 `id` 交给唯一的孩子（输入框）。
 *
 * 用 cloneElement 而不是要求调用方自己传 id：调用点有四处，
 * 每处都手写一遍 id 迟早会有人忘——忘掉的那处就丢了标签关联。
 */
function FieldControl({ id, children }: { id: string; children: ReactNode }): ReactNode {
  if (!isValidElement<{ id?: string }>(children)) return children;
  return cloneElement(children, { id });
}
