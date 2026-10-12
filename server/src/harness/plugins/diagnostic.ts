/** 插件诊断的构造：级别、归属组件与中文说明，装载各环节共用一套口径 */
import type {
  PluginComponentGroup,
  PluginDiagnosticLevel,
  PluginDiagnosticView,
} from "@ucode/contracts";

export const diagnostic = (
  level: PluginDiagnosticLevel,
  component: PluginComponentGroup,
  message: string,
): PluginDiagnosticView => ({ level, component, message });

/** 把异常收敛成一行说明：诊断面向用户，不带堆栈 */
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
