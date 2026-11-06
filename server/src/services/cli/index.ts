/**
 * CLI 命令面：帮助、补全、自检与升级检查。命令与选项都声明在 `spec`，这里只负责渲染。
 *
 * 文本生成与自检判定都是纯函数 / 只读查询，方便单测；真正的副作用（起停进程、读日志、开浏览器）
 * 留在 `cli.ts` 与 `platform/` —— 这两处才是需要按场合收敛的地方。
 */
export { COMPLETION_SHELLS, isCompletionShell, renderCompletion } from "./completion";
export {
  type DoctorCheck,
  type DoctorLevel,
  type DoctorReport,
  renderDoctor,
  renderDoctorJson,
  runDoctor,
} from "./doctor";
export { renderCommandHelp, renderOverview } from "./help";
export {
  CLI_COMMANDS,
  CLI_OPTIONS,
  type CliCommand,
  type CliOption,
  type CliOptionName,
  commandNames,
  findCommand,
  findOption,
  optionsOf,
} from "./spec";
export {
  checkForUpdate,
  compareVersions,
  renderUpdate,
  renderUpdateJson,
  type UpdateCheck,
} from "./update-check";
