/**
 * 把中继的模型端点注入成本机的普通 provider：固定 id `relay`、名称「中继」、凭证用设备令牌。
 *
 * 清单只能现拉中继的 `/v1/models`——中继侧的厂商随时会变，写死或补占位模型都会让用户以为能用。
 * 写入一律经 `applyConfig`（落盘 + 重建运行时），这里不碰 config.json。
 */
import type {
  AppConfigPatchInput,
  HubProviderOutcome,
  HubProviderResponse,
  ProviderConfig,
  ProviderModel,
} from "@ucode/contracts";
import { ERROR_CODES } from "@ucode/contracts";

import { inferModelCapabilities } from "../../config/model-capabilities";
import { parseProviderModels, type RawModelEntry } from "../../config/provider-models";
import {
  HUB_HTTP_TIMEOUT_MS,
  HUB_MODEL_API_PATH,
  HUB_PROVIDER_ID,
  HUB_PROVIDER_NAME,
} from "../../constants/hub";
import { AppError } from "../../platform/response";
import { HUB_CLIENT_ERROR_CODES, type HubClientErrorCode, hubFailureOf } from "./client";

/** 用量与计价在中继侧（按调用账号记账），本机不换算成本；契约里 cost 必填，故显式记 0 */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** 中继模型端点的根地址：中继的对话与模型清单端点都在它下面 */
export const hubModelBaseUrl = (hubUrl: string): string =>
  `${hubUrl.trim().replace(/\/+$/, "")}${HUB_MODEL_API_PATH}`;

/**
 * 清单条目 → 配置里的模型：中继只保证给 id 与展示名，思考 / 读图 / 窗口按 id 关键词与条目自带的元数据推断。
 * 展示名与 id 相同时不写：pi 本来就回落 id，写进去只是冗余。
 */
export const relayModelsOf = (entries: RawModelEntry[]): ProviderModel[] =>
  entries.map((entry) => {
    const capabilities = inferModelCapabilities(entry.id, {
      upstream: {
        reasoning: null,
        vision: null,
        contextWindow: entry.contextWindow,
        maxTokens: entry.maxTokens,
      },
    });
    const input: ProviderModel["input"] = capabilities.vision ? ["text", "image"] : ["text"];

    return {
      id: entry.id,
      ...(entry.name === entry.id ? {} : { name: entry.name }),
      reasoning: capabilities.reasoning,
      input,
      contextWindow: capabilities.contextWindow,
      maxTokens: capabilities.maxTokens,
      cost: NO_COST,
    };
  });

/** 注入用的 provider 形状：id 与名称固定，凭证是设备令牌（中继侧只存它的哈希，明文只在本机） */
export const relayProviderOf = (input: {
  baseUrl: string;
  deviceToken: string;
  models: ProviderModel[];
}): ProviderConfig => ({
  id: HUB_PROVIDER_ID,
  name: HUB_PROVIDER_NAME,
  baseUrl: input.baseUrl,
  api: "openai-completions",
  apiKey: input.deviceToken,
  models: input.models,
});

/**
 * 本次写入与已有配置的关系。同 id 而端点不同说明用户拿这个 id 配过别的供应商，
 * 会被这次写入换掉——界面要据此说明，不能让覆盖无声发生。
 */
export const relayProviderOutcome = (
  providers: ProviderConfig[],
  baseUrl: string,
): HubProviderOutcome => {
  const existing = providers.find((provider) => provider.id === HUB_PROVIDER_ID);
  if (!existing) return "created";
  return existing.baseUrl === baseUrl ? "updated" : "overwritten";
};

/** 幂等写入：同 id 的在原位替换，其余 provider 与其顺序都不动（patch 的 providers 是全量替换语义） */
export const withRelayProvider = (
  providers: ProviderConfig[],
  relay: ProviderConfig,
): ProviderConfig[] =>
  providers.some((provider) => provider.id === relay.id)
    ? providers.map((provider) => (provider.id === relay.id ? relay : provider))
    : [...providers, relay];

/**
 * 中继调用失败 → 本服务对外错误。中文明细沿用 `hubFailureOf`（它优先取中继回的 `{ error }`），
 * 错误码换成各端已有文案的那几个，界面才不必为这条链路新增一套错误文案。
 */
const toAppError = (
  failure: { code: HubClientErrorCode; message: string; detail: string },
  url: string,
  status: number | null,
): AppError => {
  switch (failure.code) {
    case HUB_CLIENT_ERROR_CODES.unreachable:
      return new AppError(ERROR_CODES.hubUnreachable, failure.message, 502, failure.detail, {
        url,
        reason: failure.detail,
      });
    case HUB_CLIENT_ERROR_CODES.unauthorized:
      // 设备令牌无效或已被吊销：与「中继登录失败」同一处置（重新登录）
      return new AppError(ERROR_CODES.hubLoginFailed, failure.message, 401, failure.detail, {
        reason: failure.detail,
      });
    case HUB_CLIENT_ERROR_CODES.rateLimited:
      return new AppError(ERROR_CODES.rateLimited, failure.message, 429);
    default:
      // 被拒 / 响应认不出：按上游故障报，客户端文案带状态码
      return new AppError(ERROR_CODES.upstreamError, failure.message, 502, failure.detail, {
        url,
        status: status === null ? "?" : String(status),
      });
  }
};

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.name === "TimeoutError"
    ? `超时（${HUB_HTTP_TIMEOUT_MS} ms）`
    : error instanceof Error
      ? error.message
      : String(error);

/** 拉模型清单；注入替身即可在用例里不连网 */
export type HubModelLister = (input: {
  baseUrl: string;
  deviceToken: string;
}) => Promise<RawModelEntry[]>;

/**
 * 缺省实现：打中继的 `GET <baseUrl>/models`，鉴权与对话端点同一口径（设备令牌）。
 *
 * 刻意不转调 config 层的 `fetchProviderModels`：那条路径按「配置 provider 表单」的口径报错
 * （空清单会报成「上游返回 HTTP 200」），而中继这里的两种状态——设备令牌不被接受、后台没配厂商——
 * 都要各自的中文原因。解析复用同一份 `parseProviderModels`。
 */
export const listHubModels: HubModelLister = async (input) => {
  const url = `${input.baseUrl}/models`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${input.deviceToken}` },
      signal: AbortSignal.timeout(HUB_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = reasonOf(error);
    throw toAppError(
      {
        code: HUB_CLIENT_ERROR_CODES.unreachable,
        message: `无法连接中继 ${url}：${reason}`,
        detail: reason,
      },
      url,
      null,
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // 非 JSON（网关错误页一类）由下面的状态码分支处理：非 2xx 时仍要拿到中继回的文案
  }

  if (!response.ok) throw toAppError(hubFailureOf(response.status, payload), url, response.status);
  if (payload === null) {
    throw toAppError(
      {
        code: HUB_CLIENT_ERROR_CODES.invalidResponse,
        message: `中继 ${url} 回了无法解析的响应`,
        detail: `响应无法解析（HTTP ${response.status}）`,
      },
      url,
      response.status,
    );
  }

  return parseProviderModels(payload);
};

export type HubProviderDeps = {
  /** 读当前配置里的 provider 清单：幂等判定与保留其余供应商都靠它 */
  getProviders: () => ProviderConfig[];
  /** 落盘并重建运行时（服务层的 applyConfig） */
  applyConfig: (patch: AppConfigPatchInput) => Promise<void>;
  /** 拉模型清单；缺省打中继的 `/v1/models` */
  listModels?: HubModelLister;
};

export type HubProviderInjector = {
  /** 按当前中继配置写入；缺地址、缺设备令牌、中继没有可用模型都抛 AppError */
  add(input: { url: string | null; deviceToken: string | null }): Promise<HubProviderResponse>;
};

export const createHubProviderInjector = (deps: HubProviderDeps): HubProviderInjector => {
  const listModels = deps.listModels ?? listHubModels;

  return {
    async add(input) {
      const url = input.url?.trim();
      if (!url) {
        throw new AppError(
          ERROR_CODES.hubNotConfigured,
          "未配置中继地址：请先在设置的中继页登录",
          400,
        );
      }
      if (!input.deviceToken) {
        throw new AppError(ERROR_CODES.hubNotBound, "本机还没有绑定中继设备：请先登录中继", 400);
      }

      const baseUrl = hubModelBaseUrl(url);
      const models = relayModelsOf(await listModels({ baseUrl, deviceToken: input.deviceToken }));
      if (models.length === 0) {
        throw new AppError(
          ERROR_CODES.hubModelsEmpty,
          "中继没有可用的模型：请先在中继后台配置 AI 厂商",
          502,
        );
      }

      const providers = deps.getProviders();
      const outcome = relayProviderOutcome(providers, baseUrl);
      await deps.applyConfig({
        providers: withRelayProvider(
          providers,
          relayProviderOf({ baseUrl, deviceToken: input.deviceToken, models }),
        ),
      });

      return {
        providerId: HUB_PROVIDER_ID,
        baseUrl,
        models: models.map((model) => model.id),
        outcome,
      };
    },
  };
};
