/**
 * 非 hook 场景的错误文案：回调内即时提示时用调用点手上的 `t` 渲染 ApiError。
 *
 * `t` 的类型由各端 i18n 决定（web / 桌面 / 未来 TUI 各自收口），这里只按 SDK 契约收口成 `Translate`。
 */
import { describeError, type Translate } from "@ucode/sdk";

export const errorText = (translate: unknown, error: unknown): string =>
  describeError(error, translate as Translate);
