/**
 * 共享 UI 的运行时依赖注入：SDK 实例与翻译函数由各端在启动时提供。
 *
 * 组件与 hooks 通过 `getRuntime()` 取用，避免把平台相关的实例（i18n、baseUrl）
 * 耦合进共享包；各端启动时调用一次 `configureUi` 即可。
 */
import type { Locale } from "@ucode/contracts";
import {
  describeApiError as describeCode,
  describeError as describeSdkError,
  type Sdk,
  type Translate,
} from "@ucode/sdk";

export type UiRuntime = {
  sdk: Sdk;
  /** 错误码文案的翻译函数（各端的 i18n 实例） */
  translate: Translate;
  /** 切换界面语言；由各端注入（web 落 localStorage 并同步 html lang） */
  setLocale?: (locale: Locale) => void;
};

let runtime: UiRuntime | null = null;

/** 由各端启动时注入；重复调用以最后一次为准，便于测试替换 */
export const configureUi = (next: UiRuntime): void => {
  runtime = next;
};

/** 取运行时依赖；未注入即被使用说明装配顺序有问题 */
export const getRuntime = (): UiRuntime => {
  if (!runtime) {
    // i18n-ignore: 开发者错误，不面向用户
    throw new Error("UI runtime 未初始化：请在启动时先调用 configureUi");
  }
  return runtime;
};

/** 把接口异常转成当前语言的文案 */
export const describeError = (error: unknown): string =>
  describeSdkError(error, getRuntime().translate);

/** 按错误码与兜底文案解析展示文本（事件流的错误帧没有 SdkError 实例） */
export const describeApiError = (
  code: string,
  message: string,
  params?: Record<string, string>,
): string => describeCode(code, message, params, getRuntime().translate);
