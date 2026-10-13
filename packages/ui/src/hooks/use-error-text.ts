/** 把 store 里的 ApiError 按当前语言渲染成文案（含插值） */
import type { ApiError } from "@ucode/sdk";
import { useTranslation } from "react-i18next";

import { errorText } from "../utils/error-text";

/** 订阅语言变化：语言切换时同一错误自动重渲染 */
export function useErrorText(error: ApiError | null): string | null {
  const { t } = useTranslation();
  return error ? errorText(t, error) : null;
}
