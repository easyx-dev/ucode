/** web 侧的 SDK 装配：浏览器 fetch + i18n 错误文案；对外保持既有 api / 错误工具的调用形态 */
import { errorMessageKey } from "@ucode/i18n";
import { createClient, describeError as describeSdkError, SdkError } from "@ucode/sdk";

import i18n from "./i18n";

const t = i18n.t as unknown as (key: string, params?: Record<string, string>) => string;

/** 默认客户端：同源请求，错误文案走 web 的 i18n 实例 */
export const api = createClient({ translate: t });

export { SdkError as ApiRequestError };

/** 按错误码取当前语言的文案；未登记的错误码回落服务端下发的中文兜底 */
export const describeApiError = (
  code: string,
  message: string,
  params?: Record<string, string>,
): string => {
  const key = errorMessageKey(code);
  return key ? t(key, params) : message;
};

/** 把接口异常转成可直接展示的文案 */
export const describeError = (error: unknown): string => describeSdkError(error, t);
