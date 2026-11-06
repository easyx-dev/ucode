/**
 * 帮助文本：总览与单命令说明都由命令表渲染，`help`、`--help` 与参数写错时的提示打印的是同一份。
 */
import { brand } from "@ucode/brand/values";

import { serviceVersion } from "../../platform/version";
import { CLI_COMMANDS, CLI_OPTIONS, type CliOption, findCommand, optionsOf } from "./spec";

type Row = {
  /** 左列：命令名 / 选项写法 */
  label: string;
  /** 右列：说明 */
  description: string;
};

const formatOption = (option: CliOption): string => {
  const flags = [option.short ? `-${option.short}` : null, `--${option.long}`]
    .filter((flag): flag is string => flag !== null)
    .join(", ");
  return option.placeholder ? `${flags} ${option.placeholder}` : flags;
};

/** 左列对齐到最宽的一项：命令与选项的说明都靠右列起头 */
const renderRows = (rows: readonly Row[]): string => {
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  return rows.map((row) => `  ${row.label.padEnd(width)}  ${row.description}`).join("\n");
};

/** 不属于任何子命令的全局写法 */
const GLOBAL_OPTIONS: readonly Row[] = [
  { label: "-v, --version", description: "打印版本" },
  { label: "-h, --help", description: "打印帮助" },
];

export const renderOverview = (): string =>
  [
    `${brand.name} ${serviceVersion}`,
    "",
    `用法：${brand.slug} <命令> [选项]`,
    "",
    "命令：",
    renderRows(
      CLI_COMMANDS.map((command) => ({ label: command.name, description: command.summary })),
    ),
    "",
    "选项：",
    renderRows([
      ...CLI_OPTIONS.map((option) => ({
        label: formatOption(option),
        description: option.description,
      })),
      ...GLOBAL_OPTIONS,
    ]),
    "",
    `更多：${brand.slug} help <命令> 查看单项说明（等同 <命令> --help）。`,
  ].join("\n");

/** 单项帮助；命令未知时回传 undefined，由调用方决定怎么报错 */
export const renderCommandHelp = (name: string): string | undefined => {
  const command = findCommand(name);
  if (!command) return undefined;

  const options = optionsOf(command);
  const usage = [
    brand.slug,
    command.name,
    command.positional,
    options.length > 0 ? "[选项]" : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  const rows: Row[] = [
    ...options.map((option) => ({
      label: formatOption(option),
      description: option.description,
    })),
    { label: "-h, --help", description: `打印 ${command.name} 的帮助` },
  ];

  return [`用法：${usage}`, "", command.summary, "", "选项：", renderRows(rows)].join("\n");
};
