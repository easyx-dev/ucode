import { Loader2, Plus, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api, ApiRequestError } from "@/lib/api";
import { API_TYPES, THINKING_LEVELS } from "@/lib/types";
import type { ApiType, ProviderModelView, ThinkingLevel } from "@/lib/types";

type DraftModel = {
  key: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
  cost: ProviderModelView["cost"];
  compat?: Record<string, unknown>;
};

type DraftProvider = {
  key: string;
  id: string;
  name: string;
  baseUrl: string;
  api: ApiType;
  apiKey: string;
  apiKeyMasked: string;
  models: DraftModel[];
};

let keySeed = 0;
const nextKey = (): string => `k${(keySeed += 1)}`;

const toDraftProvider = (provider: {
  id: string;
  name: string;
  baseUrl: string;
  api: ApiType;
  apiKeyMasked: string;
  models: ProviderModelView[];
}): DraftProvider => ({
  key: nextKey(),
  id: provider.id,
  name: provider.name,
  baseUrl: provider.baseUrl,
  api: provider.api,
  apiKey: "",
  apiKeyMasked: provider.apiKeyMasked,
  models: provider.models.map((model) => ({
    key: nextKey(),
    id: model.id,
    name: model.name ?? "",
    reasoning: model.reasoning,
    contextWindow: String(model.contextWindow),
    maxTokens: String(model.maxTokens),
    cost: model.cost,
    compat: model.compat,
  })),
});

const emptyProvider = (): DraftProvider => ({
  key: nextKey(),
  id: "local",
  name: "Local Gateway",
  baseUrl: "http://localhost:8317/v1",
  api: "openai-completions",
  apiKey: "",
  apiKeyMasked: "",
  models: [
    {
      key: nextKey(),
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      reasoning: true,
      contextWindow: "128000",
      maxTokens: "8192",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
});

const describeError = (error: unknown): string =>
  error instanceof ApiRequestError ? error.message : String(error);

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function SettingsDialog({ open, onOpenChange, onSaved }: SettingsDialogProps) {
  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("off");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { config } = await api.config.info();
      setProviders(config.providers.map(toDraftProvider));
      setDefaultModel(config.defaultModel ?? "");
      setThinkingLevel(config.thinkingLevel);
    } catch (error) {
      toast.error(`配置加载失败：${describeError(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const patchProvider = (key: string, patch: Partial<DraftProvider>) => {
    setProviders((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const patchModel = (providerKey: string, modelKey: string, patch: Partial<DraftModel>) => {
    setProviders((prev) =>
      prev.map((provider) =>
        provider.key !== providerKey
          ? provider
          : {
              ...provider,
              models: provider.models.map((model) =>
                model.key === modelKey ? { ...model, ...patch } : model,
              ),
            },
      ),
    );
  };

  const options = providers.flatMap((provider) =>
    provider.models
      .filter((model) => provider.id.trim() && model.id.trim())
      .map((model) => ({
        value: `${provider.id.trim()}/${model.id.trim()}`,
        label: `${provider.name || provider.id} · ${model.name || model.id}`,
      })),
  );

  const save = async () => {
    setSaving(true);
    try {
      await api.config.update({
        providers: providers.map((provider) => ({
          id: provider.id.trim(),
          name: provider.name.trim() || undefined,
          baseUrl: provider.baseUrl.trim(),
          api: provider.api,
          ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
          models: provider.models.map((model) => ({
            id: model.id.trim(),
            name: model.name.trim() || undefined,
            reasoning: model.reasoning,
            contextWindow: Number(model.contextWindow) || 128000,
            maxTokens: Number(model.maxTokens) || 8192,
            cost: model.cost,
            ...(model.compat ? { compat: model.compat } : {}),
          })),
        })),
        defaultModel: defaultModel || null,
        thinkingLevel,
      });
      toast.success("配置已保存");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(`保存失败：${describeError(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async (provider: DraftProvider) => {
    const model = provider.models[0]?.id.trim();
    if (!provider.baseUrl.trim() || !model) {
      toast.error("先填写 baseUrl 和至少一个模型 id");
      return;
    }
    setTestingKey(provider.key);
    try {
      const result = await api.config.test({
        baseUrl: provider.baseUrl.trim(),
        providerId: provider.id.trim() || undefined,
        ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
        api: provider.api,
        model,
      });
      toast.success(`连接成功 · ${result.latencyMs}ms · ${result.modelEcho ?? "-"}`);
    } catch (error) {
      toast.error(`连接失败：${describeError(error)}`);
    } finally {
      setTestingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>模型设置</DialogTitle>
          <DialogDescription>
            配置 OpenAI 兼容端点。保存后会重建 pi 运行时；apiKey 留空表示沿用已保存的 key。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-1 flex-1 px-1">
          <div className="space-y-4 py-1">
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载中…
              </div>
            ) : null}

            {!loading && providers.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                还没有配置 provider，点击下面「添加 provider」。
              </p>
            ) : null}

            {providers.map((provider) => (
              <div key={provider.key} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">provider</Badge>
                  <span className="text-xs text-muted-foreground">
                    {provider.apiKeyMasked ? `已保存 key ${provider.apiKeyMasked}` : "未保存 key"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => void testProvider(provider)}
                    disabled={testingKey === provider.key}
                  >
                    {testingKey === provider.key ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Zap className="size-4" />
                    )}
                    测试连接
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setProviders((prev) => prev.filter((item) => item.key !== provider.key))
                    }
                    title="删除 provider"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">id</Label>
                    <Input
                      value={provider.id}
                      onChange={(event) => patchProvider(provider.key, { id: event.target.value })}
                      placeholder="local"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">名称</Label>
                    <Input
                      value={provider.name}
                      onChange={(event) => patchProvider(provider.key, { name: event.target.value })}
                      placeholder="Local Gateway"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">baseUrl</Label>
                    <Input
                      value={provider.baseUrl}
                      onChange={(event) =>
                        patchProvider(provider.key, { baseUrl: event.target.value })
                      }
                      placeholder="http://localhost:8317/v1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">api</Label>
                    <Select
                      value={provider.api}
                      onValueChange={(value) =>
                        patchProvider(provider.key, { api: value as ApiType })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {API_TYPES.map((api) => (
                          <SelectItem key={api} value={api}>
                            {api}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">apiKey</Label>
                    <Input
                      type="password"
                      value={provider.apiKey}
                      onChange={(event) =>
                        patchProvider(provider.key, { apiKey: event.target.value })
                      }
                      placeholder={provider.apiKeyMasked || "sk-..."}
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  {provider.models.map((model) => (
                    <div key={model.key} className="grid items-end gap-2 sm:grid-cols-12">
                      <div className="space-y-1.5 sm:col-span-3">
                        <Label className="text-[11px] text-muted-foreground">模型 id</Label>
                        <Input
                          value={model.id}
                          onChange={(event) =>
                            patchModel(provider.key, model.key, { id: event.target.value })
                          }
                          placeholder="deepseek-v4-flash"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-3">
                        <Label className="text-[11px] text-muted-foreground">显示名</Label>
                        <Input
                          value={model.name}
                          onChange={(event) =>
                            patchModel(provider.key, model.key, { name: event.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-[11px] text-muted-foreground">context</Label>
                        <Input
                          value={model.contextWindow}
                          onChange={(event) =>
                            patchModel(provider.key, model.key, { contextWindow: event.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-[11px] text-muted-foreground">maxTokens</Label>
                        <Input
                          value={model.maxTokens}
                          onChange={(event) =>
                            patchModel(provider.key, model.key, { maxTokens: event.target.value })
                          }
                        />
                      </div>
                      <label className="flex h-8 items-center gap-1.5 text-xs sm:col-span-1">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={model.reasoning}
                          onChange={(event) =>
                            patchModel(provider.key, model.key, { reasoning: event.target.checked })
                          }
                        />
                        think
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="sm:col-span-1"
                        onClick={() =>
                          patchProvider(provider.key, {
                            models: provider.models.filter((item) => item.key !== model.key),
                          })
                        }
                        title="删除模型"
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchProvider(provider.key, {
                        models: [
                          ...provider.models,
                          {
                            key: nextKey(),
                            id: "",
                            name: "",
                            reasoning: true,
                            contextWindow: "128000",
                            maxTokens: "8192",
                            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="size-4" />
                    添加模型
                  </Button>
                </div>
              </div>
            ))}

            <Button variant="outline" onClick={() => setProviders((prev) => [...prev, emptyProvider()])}>
              <Plus className="size-4" />
              添加 provider
            </Button>

            <Separator />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">默认模型</Label>
                <Select
                  value={options.some((option) => option.value === defaultModel) ? defaultModel : ""}
                  onValueChange={setDefaultModel}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择默认模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">thinking level</Label>
                <Select
                  value={thinkingLevel}
                  onValueChange={(value) => setThinkingLevel(value as ThinkingLevel)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THINKING_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            保存并生效
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
