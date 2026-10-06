/**
 * 模型能力的推断：把「已保存配置 / 上游条目 / pi 内置目录 / 模型 id 关键词」几层信息
 * 收敛成一组可直接落成 `ProviderModel` 的取值。
 *
 * 上游的 `/models` 只保证给出模型 id，思考 / 读图 / 上下文窗口都不在其中（pi 也只把这类
 * 参数放在静态目录里），因此这里做隐式推断而不是留空：留空会让设置页保存出与 schema 默认值
 * 相同的值，却看不出「这是推断的」，`capabilitySource` 就是给界面标注可信度用的。
 */
import type { ModelCapabilitySource } from "@ucode/contracts";

/** 无任何依据时的回路值：与 `providerModelSchema` 的默认值一致，避免保存后行为漂移 */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

/** 一档能力取值；`null` 表示该档没提供这一项 */
export type CapabilityValues = {
  reasoning: boolean | null;
  vision: boolean | null;
  contextWindow: number | null;
  maxTokens: number | null;
};

/** 推断可用的各层线索，缺层即跳过 */
export type ModelCapabilityHints = {
  /** 当前 provider 已保存的同 id 模型：用户确认过的值，优先级最高 */
  configured?: CapabilityValues;
  /** 上游条目自带的元数据（OpenRouter / vLLM 一类网关会返回窗口与输出上限） */
  upstream?: CapabilityValues;
  /** pi 内置目录里同 id 的条目；只有已接入的内置 provider 才带窗口参数 */
  catalog?: CapabilityValues;
};

export type ResolvedModelCapabilities = {
  reasoning: boolean;
  vision: boolean;
  contextWindow: number;
  maxTokens: number;
  /** 取值来源（最高命中层） */
  source: ModelCapabilitySource;
};

/**
 * 按模型 id 关键词推断能力的规则表，按声明顺序逐字段取首个命中的规则。
 *
 * 只收录从 id 就能确定的标记：厂商把推理 / 视觉能力写进了命名（`o3-mini`、`-vl`、`reasoner`），
 * 这些标记比「按家族猜」可靠。拿不准的 id 不猜，交给下游默认值——宁可保守也不要误导用户。
 * 新增厂商的关键词只需往表里加一条。
 */
const CAPABILITY_RULES: Array<{
  pattern: RegExp;
  reasoning?: boolean;
  vision?: boolean;
}> = [
  // 推理模型的命名标记：OpenAI 的 o 系、各家的 -r1 / reasoner / thinking，以及 Qwen 的 qwq
  { pattern: /(?:^|[-_/])o[1-9](?:-mini)?(?:$|[-_/])/, reasoning: true },
  { pattern: /(?:reasoning|reasoner|thinking|qwq|(?:^|[-_/])r1(?:$|[-_/]))/, reasoning: true },
  // 视觉能力：显式标记 + 明确全系支持图片输入的家族
  {
    pattern: /(?:vision|multimodal|omni|pixtral|llava|internvl|(?:^|[-_/])vl(?:$|[-_/])|-vl-|-vl$)/,
    vision: true,
  },
  { pattern: /(?:gpt-4o|gpt-4\.1|gpt-5|claude-|gemini-|glm-4v|qwen-?vl)/, vision: true },
];

/** 按 id 关键词推断；id 统一转小写后再匹配，大小写不同的写法都能命中 */
export const inferFromModelId = (id: string): Partial<CapabilityValues> => {
  const lower = id.toLowerCase();
  const inferred: Partial<CapabilityValues> = {};

  for (const rule of CAPABILITY_RULES) {
    if (inferred.reasoning === undefined && rule.reasoning !== undefined) {
      if (rule.pattern.test(lower)) inferred.reasoning = rule.reasoning;
    }
    if (inferred.vision === undefined && rule.vision !== undefined) {
      if (rule.pattern.test(lower)) inferred.vision = rule.vision;
    }
  }

  return inferred;
};

/** 该层是否提供了任意一项；单层里部分字段为空不等于该层没参与 */
const hasAnyValue = (values?: Partial<CapabilityValues>): boolean =>
  values !== undefined &&
  Object.values(values).some((value) => value !== undefined && value !== null);

/** 逐项按 configured → upstream → catalog → heuristic 取第一个非空值 */
export const inferModelCapabilities = (
  id: string,
  hints: ModelCapabilityHints,
): ResolvedModelCapabilities => {
  const tiers: Array<{ source: ModelCapabilitySource; values?: Partial<CapabilityValues> }> = [
    { source: "configured", values: hints.configured ?? undefined },
    { source: "upstream", values: hints.upstream ?? undefined },
    { source: "catalog", values: hints.catalog ?? undefined },
    { source: "heuristic", values: inferFromModelId(id) },
  ];

  // 来源按「最高命中层」记：某层只给了窗口、没给能力开关，它仍是这些取值的来源
  const source = tiers.find((tier) => hasAnyValue(tier.values))?.source ?? "default";
  const pick = <K extends keyof CapabilityValues>(key: K): CapabilityValues[K] | null => {
    for (const tier of tiers) {
      const value = tier.values?.[key];
      if (value === undefined || value === null) continue;
      return value;
    }
    return null;
  };

  return {
    reasoning: pick("reasoning") ?? false,
    vision: pick("vision") ?? false,
    contextWindow: pick("contextWindow") ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: pick("maxTokens") ?? DEFAULT_MAX_TOKENS,
    source,
  };
};
