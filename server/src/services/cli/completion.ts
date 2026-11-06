/**
 * shell 补全脚本：命令、选项与位置参数候选全部取自命令表，三个 shell 说的是同一套命令面。
 *
 * 产出的都是「可 eval 的一段脚本」，不给安装路径：写进 `.zshrc` / `.bashrc` 还是 fish 的
 * `completions/` 目录，由使用者按自己的 shell 习惯决定（README 给了三行示例）。
 */
import { brand } from "@ucode/brand/values";

import {
  CLI_COMMANDS,
  type CliOption,
  type CliOptionName,
  commandNames,
  findCommand,
  optionsOf,
} from "./spec";

export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;

export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export const isCompletionShell = (value: string): value is CompletionShell =>
  (COMPLETION_SHELLS as readonly string[]).includes(value);

const slug = brand.slug;

/** 单引号包裹：内部的 `'` 断成 `'\''`，三个 shell 都认 */
const quote = (value: string): string => `'${value.split("'").join(`'\\''`)}'`;

/** fish 的标志写法：`-s n -l lines`，与补全候选里的 `-n --lines` 不是一回事 */
const fishFlags = (option: CliOption): string[] => [
  ...(option.short ? [`-s ${option.short}`] : []),
  `-l ${option.long}`,
];

const flagsOf = (option: CliOption): string[] =>
  [option.short ? `-${option.short}` : null, `--${option.long}`].filter(
    (flag): flag is string => flag !== null,
  );

/** 命令 → 它接受的选项写法（含全局的 `-h`） */
const optionWords = (name: string): string[] => {
  const command = findCommand(name);
  if (!command) return ["-h", "--help"];
  return [...optionsOf(command).flatMap(flagsOf), "-h", "--help"];
};

/** 选项集相同的命令合成一组，脚本里的 case 分支就不会一个命令一条 */
const optionGroups = (): Array<{ commands: string[]; words: string[] }> => {
  const groups = new Map<string, { commands: string[]; words: string[] }>();
  for (const command of CLI_COMMANDS) {
    const words = optionWords(command.name);
    const key = words.join(" ");
    const group = groups.get(key);
    if (group) group.commands.push(command.name);
    else groups.set(key, { commands: [command.name], words });
  }
  return [...groups.values()];
};

/** 位置参数候选：`completion` 的 shell、`service` 的子命令、`help` 的命令名 */
const positionalGroups = (): Array<{ name: string; values: readonly string[] }> =>
  CLI_COMMANDS.flatMap((command) => {
    const values =
      command.values ??
      (command.name === "help" ? commandNames().filter((name) => name !== "help") : []);
    return values.length > 0 ? [{ name: command.name, values }] : [];
  });

/** 接受某个选项的命令（fish 用「出现该子命令时」作条件） */
const commandsAccepting = (name: CliOptionName): string[] =>
  CLI_COMMANDS.filter((command) => command.options.includes(name)).map((command) => command.name);

/**
 * bash / zsh 里的变量引用（`${…}`）不能直接写进 JS 字符串：
 * biome 会当成漏掉的模板插值（`noTemplateCurlyInString`），拼出来反而更清楚。
 */
const ref = (expression: string): string => ["$", "{", expression, "}"].join("");

const bashScript = (): string => {
  const cur = ref("cur");
  const cmd = ref("cmd");
  const opts = ref("opts");
  const lines = [
    `# ${slug} 的 bash 补全：eval "$(${slug} completion bash)"，或存进 /etc/bash_completion.d/${slug}`,
    `_${slug}() {`,
    "  local cur cmd opts",
    `  cur="${ref("COMP_WORDS[COMP_CWORD]")}"`,
    `  cmd="${ref("COMP_WORDS[1]")}"`,
    "",
    `  if [ "${ref("COMP_CWORD")}" -eq 1 ]; then`,
    `    COMPREPLY=( $(compgen -W "${commandNames().join(" ")}" -- "${cur}") )`,
    "    return 0",
    "  fi",
    "",
    `  case "${cmd}" in`,
  ];
  for (const { name, values } of positionalGroups()) {
    lines.push(
      `    ${name})`,
      `      if [ "${ref("COMP_CWORD")}" -eq 2 ]; then`,
      `        COMPREPLY=( $(compgen -W "${values.join(" ")}" -- "${cur}") )`,
      "        return 0",
      "      fi",
      "      ;;",
    );
  }
  lines.push("  esac", "", `  case "${cmd}" in`);
  for (const { commands, words } of optionGroups()) {
    lines.push(`    ${commands.join("|")}) opts="${words.join(" ")}" ;;`);
  }
  lines.push(
    '    *) opts="-h --help" ;;',
    "  esac",
    "",
    `  if [[ "${cur}" == -* ]]; then`,
    `    COMPREPLY=( $(compgen -W "${opts}" -- "${cur}") )`,
    "  fi",
    "  return 0",
    "}",
    `complete -F _${slug} ${slug}`,
  );
  return lines.join("\n");
};

const zshScript = (): string => {
  const lines = [
    `# ${slug} 的 zsh 补全：先 compinit，再 eval "$(${slug} completion zsh)"`,
    `_${slug}() {`,
    "  local -a commands",
    "  commands=(",
    ...CLI_COMMANDS.map((command) => `    ${quote(`${command.name}:${command.summary}`)}`),
    "  )",
    "",
    "  if (( CURRENT == 2 )); then",
    `    _describe -t commands '${slug} 命令' commands`,
    "    return",
    "  fi",
    "",
    `  case "${ref("words[2]")}" in`,
  ];
  for (const { name, values } of positionalGroups()) {
    lines.push(`    ${name})`, `      compadd -- ${values.join(" ")}`, "      return", "      ;;");
  }
  lines.push("  esac", "", `  case "${ref("words[2]")}" in`);
  for (const { commands, words } of optionGroups()) {
    lines.push(`    ${commands.join("|")})`, `      compadd -- ${words.join(" ")}`, "      ;;");
  }
  lines.push(
    "    *) compadd -- -h --help ;;",
    "  esac",
    "}",
    `(( $+functions[compdef] )) && compdef _${slug} ${slug}`,
  );
  return lines.join("\n");
};

const fishScript = (): string => {
  const complete = (...parts: string[]): string => `complete -c ${slug} ${parts.join(" ")}`;
  const lines = [
    `# ${slug} 的 fish 补全：${slug} completion fish > ~/.config/fish/completions/${slug}.fish`,
    complete("-f"),
    complete(`-s h -l help -d ${quote("打印帮助")}`),
    complete(`-s v -l version -d ${quote("打印版本")}`),
  ];
  for (const command of CLI_COMMANDS) {
    lines.push(
      complete(`-n __fish_use_subcommand -a ${command.name} -d ${quote(command.summary)}`),
    );
  }
  for (const { name, values } of positionalGroups()) {
    lines.push(
      complete(`-n ${quote(`__fish_seen_subcommand_from ${name}`)} -a ${quote(values.join(" "))}`),
    );
  }
  for (const option of CLI_COMMANDS.flatMap((command) => optionsOf(command))) {
    const commands = commandsAccepting(option.name);
    const line = complete(
      `-n ${quote(`__fish_seen_subcommand_from ${commands.join(" ")}`)}`,
      ...fishFlags(option),
      ...(option.type === "string" ? ["-r"] : []),
      `-d ${quote(option.description)}`,
    );
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.join("\n");
};

/** 生成指定 shell 的补全脚本；未知 shell 回传 undefined */
export const renderCompletion = (shell: string): string | undefined => {
  if (shell === "bash") return bashScript();
  if (shell === "zsh") return zshScript();
  if (shell === "fish") return fishScript();
  return undefined;
};
