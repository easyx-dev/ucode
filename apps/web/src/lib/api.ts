/** web 侧的接口入口：转发 SDK 客户端与错误文案工具，保持既有调用形态 */
import {
  describeApiError as describeCode,
  describeError as describeRaw,
  SdkError,
} from "@ucode/sdk";

import { sdk, translate } from "./sdk";

/** 默认客户端：同源请求 */
export const api = sdk.client;

export { SdkError as ApiRequestError };

/** 按错误码取当前语言的文案；未登记的错误码回落服务端下发的中文兜底 */
export const describeApiError = (
  code: string,
  message: string,
  params?: Record<string, string>,
): string => describeCode(code, message, params, translate);

/** 把接口异常转成可直接展示的文案 */
export const describeError = (error: unknown): string => describeRaw(error, translate);
