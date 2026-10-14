/** 资产表单的字段状态与请求组装：三种资产共用一份，按 `kind` 决定校验与最终字段 */
import type {
  AssetDetail,
  AssetKind,
  AssetScope,
  AssetsSaveRequest,
  ThinkingLevel,
} from "@ucode/contracts";

/** 工具名输入框的拆分：逗号与换行都当作分隔符 */
const toolsOf = (text: string): string[] | undefined => {
  const items = text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
};

export type AssetFormState = {
  name: string;
  label: string;
  description: string;
  mode: "primary" | "subagent" | "all";
  /** 工具名，逗号或换行分隔；空表示继承父会话（子角色）或用默认工具集（主角色） */
  toolsText: string;
  model: string;
  /** 空串表示不指定 */
  thinking: ThinkingLevel | "";
  advertise: boolean;
  hidden: boolean;
  argumentHint: string;
  body: string;
  scope: AssetScope;
};

/** 名称规则与服务端同一口径：客户端先挡一道，省一次往返 */
export const ASSET_NAME_PATTERNS: Record<AssetKind, RegExp> = {
  agent: /^[a-z][a-z0-9-]*$/,
  skill: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  command: /^[a-z0-9][a-z0-9-]*$/,
};

export const isAssetNameValid = (kind: AssetKind, name: string): boolean =>
  name.length > 0 && name.length <= 64 && ASSET_NAME_PATTERNS[kind].test(name);

export const emptyAssetForm = (scope: AssetScope = "global"): AssetFormState => ({
  name: "",
  label: "",
  description: "",
  mode: "subagent",
  toolsText: "",
  model: "",
  thinking: "",
  advertise: true,
  hidden: false,
  argumentHint: "",
  body: "",
  scope,
});

export const assetToForm = (detail: AssetDetail): AssetFormState => ({
  name: detail.name,
  label: detail.label === detail.name ? "" : detail.label,
  description: detail.description,
  mode: detail.mode ?? "subagent",
  toolsText: (detail.tools ?? []).join(", "),
  model: detail.model ?? "",
  thinking: detail.thinking ?? "",
  advertise: detail.advertise ?? true,
  hidden: detail.hidden ?? false,
  argumentHint: detail.argumentHint ?? "",
  body: detail.body,
  scope: detail.scope ?? "global",
});

/** 提交按钮的可用性：新建才校验名字（编辑态名字就是定位依据，不允许改） */
export const canSubmitAssetForm = (
  kind: AssetKind,
  form: AssetFormState,
  isNew: boolean,
): boolean => {
  if (!form.body.trim()) return false;
  if (isNew && !isAssetNameValid(kind, form.name)) return false;
  // 角色与技能的 description 必填：缺了整条不会被装载
  if (kind !== "command" && !form.description.trim()) return false;
  return true;
};

/** 表单 → 保存请求；`extraLines` 由调用方带上（编辑态原样回传，新建时为空） */
export const formToSaveRequest = (
  kind: AssetKind,
  form: AssetFormState,
  extraLines: readonly string[],
): AssetsSaveRequest => {
  const base: AssetsSaveRequest = {
    kind,
    name: form.name.trim(),
    scope: form.scope,
    body: form.body,
    ...(extraLines.length > 0 ? { extraLines: [...extraLines] } : {}),
  };

  if (kind === "agent") {
    const tools = toolsOf(form.toolsText);
    return {
      ...base,
      ...(form.label.trim() ? { label: form.label.trim() } : {}),
      description: form.description.trim(),
      mode: form.mode,
      ...(tools ? { tools } : {}),
      ...(form.model.trim() ? { model: form.model.trim() } : {}),
      ...(form.thinking ? { thinking: form.thinking } : {}),
      advertise: form.advertise,
      hidden: form.hidden,
    };
  }

  if (kind === "skill") return { ...base, description: form.description.trim() };

  return {
    ...base,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.argumentHint.trim() ? { argumentHint: form.argumentHint.trim() } : {}),
  };
};
