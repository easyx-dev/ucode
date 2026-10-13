/**
 * `@ucode/ui` 出口：运行时 Provider 与 hooks。
 *
 * 组件与纯逻辑经子路径导入：`@ucode/ui/base/*`、`@ucode/ui/business/*`、`@ucode/ui/utils/*`、
 * `@ucode/ui/presets/workspace`。
 */
export { ErrorToaster } from "./business/shell/error-toaster";
export { type Observable, useStore } from "./hooks/use-store";
export { UiProvider, type UiProviderProps, useClient } from "./provider";
