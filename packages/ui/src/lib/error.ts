/** UI 侧错误文案：把 store 里的 ApiError 按当前语言渲染（含插值） */
import { type ApiError, describeError, type Translate } from "@ucode/sdk";
import { useTranslation } from "react-i18next";

/** 订阅语言变化：语言切换时同一错误自动重渲染 */
export const useErrorText = (error: ApiError | null): string | null => {
  const { t } = useTranslation();
  return error ? describeError(error, t as unknown as Translate) : null;
};

/** 非 hook 场景（回调内即时提示）用当前渲染的 t 翻译；t 的类型由各端 i18n 决定，这里只按契约收口 */
export const errorText = (translate: unknown, error: unknown): string =>
  describeError(error, translate as Translate);
