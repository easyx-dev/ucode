/**
 * 只读命令判定：给只读角色（plan / ask / explore）的执行类工具开一道「只读命令」的门。
 *
 * 判据是**保守**的：证明不了这条命令只读就不放行。判定分两步，都按 shell 的真实语义做，
 * 不在原始文本上做字符串匹配（那是上一版漏掉 `--out\put`、`-ro`、`--outp=` 这类写法的根源）：
 *
 * 1. `parse`：按**方言的词法**切词与切命令（`shell` 选 bash 还是 PowerShell）。引号、反斜杠转义、
 *    行续接都按方言处理；引号外的重定向、`$` 与反引号、`(` `)` `{` `}`、未闭合的引号一律判为不可判定。
 * 2. `isReadOnlyWords`：每条简单命令的第一个词必须在白名单里；选项按 GNU / git 的语法匹配
 *    （长选项的无歧义缩写、短选项簇）；通配符展开出的参数不允许流向有选项的命令（展开结果可能以 `-` 开头）。
 *
 * 两个 shell 共用一份白名单，但**词法必须分开**：`\` 只在 bash 里是转义，PowerShell 里它是普通字符
 * （`C:\` 随处可见），当成转义会把紧跟其后的 `;` / `|` 吃掉，让第二条命令混进同一个词、逃过白名单。
 *
 * 不是 OS 级沙箱：由仓库或用户配置决定的执行面不在判定内（`git` 的 `diff.external` / textconv /
 * 分页器 / gpg 签名校验 / filter 等，见 `docs/modes-and-permissions.md`「安全边界」）。
 * 与 `harness/features/shell/blocked.ts` 的分工：那处是执行期的启发式（拦固定空等），漏判只影响体验；
 * 这里的漏判等于放行，所以两处口径刻意不同，不要合并。
 */

/** 命令词法：两个 shell 的引号与转义规则不同，白名单相同 */
export type CommandShell = "posix" | "powershell";

/** 一个 shell 词：引号与转义已按 shell 规则去掉；`unquotedGlob` 记录引号外是否含通配符 */
type Word = { text: string; unquotedGlob: boolean };

/** 一条命令的只读口径：默认「任何参数都只读」，例外在这里逐条写明 */
type ReadOnlySpec = {
  /** 允许的只读子命令（多级命令用，如 `git log`）；给了它就要求子命令正好是第一个参数 */
  subcommands?: readonly string[];
  /**
   * 会写盘 / 执行代码的选项，匹配规则见 `optionHit`。
   * 注意：每新增一个白名单命令，都要逐个核对它的选项表（尤其是输出文件、外部程序、临时目录类）。
   */
  denyArgs?: readonly string[];
  /** 位置参数上限（`uniq in out` 的第二个位置参数是输出文件），超出即不放行 */
  maxPositionals?: number;
};

const READ_ONLY_COMMANDS: Readonly<Record<string, ReadOnlySpec>> = {
  // 文件与目录：读内容与元数据
  ls: {},
  cat: {},
  head: {},
  tail: {},
  wc: {},
  pwd: {},
  stat: {},
  // `-C` 会在当前目录写编译后的 magic 文件
  file: { denyArgs: ["-C", "--compile"] },
  du: {},
  df: {},
  // `-o FILE` 把输出写到任意文件；`-R` 在每个目录里写 00Tree.html
  tree: { denyArgs: ["-o", "-R"] },
  readlink: {},
  realpath: {},
  basename: {},
  dirname: {},
  // 检索与文本处理：结果只往 stdout 写（重定向已被扫描挡掉）
  // `--pre` 对每个文件执行外部命令；`--hostname-bin` 执行外部命令取主机名
  rg: { denyArgs: ["--pre", "--hostname-bin"] },
  grep: {},
  jq: {},
  find: {
    denyArgs: ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"],
  },
  // `-o` 写输出文件；`--compress-program` 执行外部程序；`-T` 在指定目录写临时文件
  sort: { denyArgs: ["-o", "--output", "-T", "--temporary-directory", "--compress-program"] },
  cut: {},
  tr: {},
  nl: {},
  comm: {},
  diff: {},
  // `uniq [INPUT [OUTPUT]]`：第二个位置参数会写文件，因此只认一个
  uniq: { maxPositionals: 1 },
  // git 只读子命令：写类（commit / push / stash / config…）不列，全局开关（`git -c`）也不放行。
  // 写文件：`--output`。调起外部程序：`--ext-diff` / `--textconv` / `--filters`（cat-file）/
  // `-O` 与 `--open-files-in-pager`（grep，把文件交给分页器）/ `--show-signature`（调 gpg）。
  git: {
    subcommands: [
      "status",
      "log",
      "diff",
      "show",
      "blame",
      "describe",
      "rev-parse",
      "rev-list",
      "ls-files",
      "ls-tree",
      "cat-file",
      "shortlog",
      "whatchanged",
      "grep",
    ],
    denyArgs: [
      "--output",
      "--ext-diff",
      "--textconv",
      "--filters",
      "--open-files-in-pager",
      "-O",
      "--show-signature",
    ],
  },
  // 只影响本条命令内的相对路径，后续段落仍逐条判定
  cd: {},
  // Windows 的 PowerShell 通道：只列只读 cmdlet，不列别名（同名别名在 posix 那批里已有）
  "get-childitem": {},
  "get-content": {},
  "get-item": {},
  "get-location": {},
  "select-string": {},
  "select-object": {},
  // `-FilterScript` 接受字符串并当脚本块执行
  "where-object": { denyArgs: ["-filterscript"] },
  "measure-object": {},
  "resolve-path": {},
  "test-path": {},
};

/**
 * 一个参数是否命中一条被禁选项（参数已经过 shell 去引号）。三种写法分开判，因为它们的语法不同：
 * - 长选项（`--output`）：按 GNU / git 的规则，**输入的名字是被禁名字的前缀**才算命中——
 *   `--output` / `--output=f` 是全名，`--outp` / `--out` 是无歧义缩写。反过来的前缀不算：
 *   `--pretty` 与 `--pre` 是两个选项，不能因为前者以它开头就拦掉；
 * - 单字母短选项（`-o`）：可以合写，出现在短选项簇里就算（`-ro`、`-uo`、`-Ro` 都含 `o`）。
 *   大小写敏感：`git grep -O`（交给分页器）与 `-o`（只输出匹配部分）是两个选项；
 * - 多字母单横线选项（find 的 `-fprint0`、PowerShell 的 `-FilterScript`）：带后缀也算命中，
 *   它们不像 GNU 长选项那样接受缩写（大小写按 PowerShell 不敏感处理）。
 */
const optionHit = (arg: string, denied: string): boolean => {
  if (!arg.startsWith("-")) return false;
  const lowerArg = arg.toLowerCase();
  const lowerDenied = denied.toLowerCase();
  if (lowerDenied.startsWith("--")) {
    // 取 `=` / `:` 之前的部分：`--output=f` 与 `--output f` 都要认成 `--output`
    const name = (lowerArg.split(/[=:]/, 1)[0] ?? "").trim();
    return lowerDenied === name || (name.length >= 3 && lowerDenied.startsWith(name));
  }
  if (denied.length === 2) {
    return !arg.startsWith("--") && arg.slice(1).includes(denied.charAt(1));
  }
  return lowerArg.startsWith(lowerDenied);
};

const hasDeniedArg = (args: readonly string[], denyArgs: readonly string[] | undefined): boolean =>
  !!denyArgs && args.some((arg) => denyArgs.some((denied) => optionHit(arg, denied)));

type Parsed = { commands: Word[][]; opaque: boolean };

const UNDECIDABLE: Parsed = { commands: [], opaque: true };

/**
 * 按方言的词法切词与切命令。
 * - 单引号内一切都是字面量（反斜杠不转义，`'a\'` 在第二个 `'` 处就结束了）；
 * - 双引号内 bash 只把 `\"` 与 `\\` 当转义，PowerShell 只认反引号，故后者的 `\` 也是字面量；
 *   两边都把 `$` 与反引号（展开与命令替换）判为不可判定；
 * - 引号外：`\x` 在 bash 里是转义、`\` + 换行是行续接（PowerShell 里 `\` 只是普通字符）；
 *   `;` `&` `|` 与换行切命令；重定向与展开一律不可判定。
 * 单引号与转义的分支必须分开处理：混在一起会让 `'a\'` 把后面的 `;` 吞进字符串里。
 */
const parse = (command: string, shell: CommandShell): Parsed => {
  const commands: Word[][] = [];
  let words: Word[] = [];
  let word: Word | undefined;
  let quote: "'" | '"' | undefined;

  const current = (): Word => {
    if (!word) word = { text: "", unquotedGlob: false };
    return word;
  };
  const endWord = (): void => {
    if (word) words.push(word);
    word = undefined;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index);
    const next = command.charAt(index + 1);

    if (quote === "'") {
      if (char === "'") quote = undefined;
      else current().text += char;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = undefined;
      } else if (char === "$" || char === "`") {
        return UNDECIDABLE;
      } else if (shell === "posix" && char === "\\" && (next === '"' || next === "\\")) {
        current().text += next;
        index += 1;
      } else {
        current().text += char;
      }
      continue;
    }

    if (char === "\\" && shell === "posix") {
      if (next === "") return UNDECIDABLE;
      index += 1;
      // 行续接：反斜杠加换行整个消失，词不断开
      if (next !== "\n") current().text += next;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char === "'" ? "'" : '"';
      current();
      continue;
    }
    if (char === " " || char === "\t") {
      endWord();
      continue;
    }
    if (char === "\n" || char === ";" || char === "|" || char === "&") {
      endCommand();
      // `&&` / `||` / `;;` 与单字符分隔符等价
      if (next === char) index += 1;
      continue;
    }
    if ("$`<>(){}".includes(char)) return UNDECIDABLE;
    if (char === "*" || char === "?" || char === "[") {
      const pattern = current();
      pattern.text += char;
      pattern.unquotedGlob = true;
      continue;
    }
    current().text += char;
  }

  // 未闭合的引号在 shell 里是语法错误，不可判定
  if (quote !== undefined) return UNDECIDABLE;
  endCommand();
  return { commands, opaque: false };
};

/** 一条简单命令（已切好词）是否一定只读 */
const isReadOnlyWords = (words: readonly Word[]): boolean => {
  const [head, ...rest] = words;
  if (!head || head.unquotedGlob) return false;
  const name = head.text.toLowerCase();
  if (!Object.hasOwn(READ_ONLY_COMMANDS, name)) return false;
  const spec = READ_ONLY_COMMANDS[name];
  if (!spec) return false;

  const args = rest.map((word) => word.text);
  // 通配符展开的结果是文件名，可能以 `-` 开头，等于替你塞进一个选项；
  // 有选项表或位置参数上限的命令，一律不接受通配符参数（`sort *`、`git diff *.ts`）
  if ((spec.denyArgs || spec.maxPositionals !== undefined) && rest.some((w) => w.unquotedGlob)) {
    return false;
  }
  if (hasDeniedArg(args, spec.denyArgs)) return false;
  if (spec.subcommands && !spec.subcommands.includes(args[0] ?? "")) return false;
  if (spec.maxPositionals !== undefined) {
    const positionals = args.filter((arg) => !arg.startsWith("-")).length;
    if (positionals > spec.maxPositionals) return false;
  }
  return true;
};

/**
 * 整条命令是否「一定只读」：每一条简单命令都要命中白名单，任何一处不可判定就不放行。
 * `shell` 是这条命令的词法（两个 shell 共用白名单、不共用引号与转义规则），由调用方按工具传。
 */
export const isReadOnlyCommand = (command: string, shell: CommandShell = "posix"): boolean => {
  const parsed = parse(command, shell);
  if (parsed.opaque || parsed.commands.length === 0) return false;
  return parsed.commands.every(isReadOnlyWords);
};
