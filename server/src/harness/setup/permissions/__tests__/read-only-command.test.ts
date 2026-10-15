/**
 * 只读命令判定单测：放行「一定只读」的写法，挡住不可判定与会写盘 / 执行代码的写法。
 *
 * 用例同时钉住判定的方向：不确定的一律不放行（重定向、命令替换、变量展开、写盘参数、
 * 白名单外的命令），所以这里有大量「看起来无害但收紧了」的断言。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isReadOnlyCommand } from "../read-only-command";

describe("isReadOnlyCommand：放行", () => {
  for (const command of [
    "ls -la",
    "ls",
    "cat README.md",
    "git status",
    "git log --oneline -5",
    "git diff --stat src/a.ts",
    "git show HEAD --format=%H",
    "wc -l README.md",
    "cat a.md | head -20",
    "cd packages/ui && ls src/base",
    "rg -n 'a;b' src",
    'git log --grep="a;b"',
    "find . -name '*.ts'",
    "uniq -c file.txt",
    "sort -u file.txt",
    "cat a.md\nhead -3 b.md",
    "ls &",
    "get-content README.md",
    "get-childitem -Recurse",
  ]) {
    it(`放行：${command}`, () => {
      assert.equal(isReadOnlyCommand(command), true);
    });
  }
});

describe("isReadOnlyCommand：阻断", () => {
  for (const command of [
    "ls > out",
    "ls 2>&1",
    "head -20 < file",
    "git diff --output=f",
    "git diff --ext-diff",
    "find . -delete",
    "find . -exec rm {} ;",
    "find . -fprint out",
    "ls $(rm -rf .)",
    "ls `rm -rf .`",
    "cat $HOME/x",
    "(ls)",
    "uniq a b",
    "sort -o out file",
    "ls | tee out",
    "cat a; rm -rf .",
    "ls && rm -rf .",
    "rm -rf .",
    "pnpm check",
    "node -e 'process.exit(0)'",
    "git commit -m x",
    "git stash list",
    "git -c alias.x='!rm -rf .' x",
    "sudo ls",
    "sed -i s/a/b/ f",
    "ls # > out",
    "",
  ]) {
    it(`阻断：${command || "（空命令）"}`, () => {
      assert.equal(isReadOnlyCommand(command), false);
    });
  }
});

/**
 * 举一反三的回归用例：单引号里的反斜杠、执行 / 写盘的长短参数、缩写与通配符展开、
 * 以及「同前缀但不是同一个选项」的误拦。
 */
describe("isReadOnlyCommand：逃逸与隐藏参数（回归）", () => {
  for (const command of [
    // 单引号内反斜杠是字面量：后面的分隔符必须仍被切开
    "cat 'x\\' ; rm -rf .",
    "ls 'a\\' && rm -rf .",
    "git log 'a\\' ; rm -rf ~/x",
    // 执行外部程序 / 写文件的参数
    "rg --pre=sh .",
    "rg --pre 'rm -rf .' .",
    "rg --hostname-bin=sh x",
    "sort --compress-program=sh f",
    "git grep -O sh x",
    "git grep --open-files-in-pager=sh x",
    "git cat-file --filters HEAD:x",
    "tree -o /tmp/o .",
    "tree -R -H .",
    "file -C",
    "git diff --outp=f",
    // 多字母单横线选项带后缀也算命中（GNU 长选项的缩写规则不适用）
    "find . -fprint0 out",
    // 通配符展开可能变成选项或多个文件名
    "sort *",
    "git diff *.ts",
  ]) {
    it(`阻断：${command}`, () => {
      assert.equal(isReadOnlyCommand(command), false);
    });
  }

  for (const command of [
    // bash 里 `\;` 是字面量，`;` 不再是分隔符，只会跑 cat
    "cat a\\; rm -rf .",
    "cat 'a\\'",
    "rg -n 'a;b' src",
    // `--pretty` 与 `--pre` 是两个选项，不能因为前者以它开头就拦掉
    "rg --pretty -n foo src",
    "tree -L 2 .",
    "git log --oneline -3",
  ]) {
    it(`放行：${command}`, () => {
      assert.equal(isReadOnlyCommand(command), true);
    });
  }
});

/**
 * PowerShell 通道：与 bash 共用一份白名单，但**词法不同**——`\` 在 PowerShell 里是普通字符
 * （`C:\` 遍地都是），`;` / `|` 该切就切。
 */
describe("isReadOnlyCommand：PowerShell 方言", () => {
  for (const command of [
    "Get-Content README.md",
    "Get-ChildItem C:\\ -Recurse",
    "Select-String -Path src -Pattern foo",
    "Get-ChildItem . | Select-Object -First 3",
  ]) {
    it(`放行：${command}`, () => {
      assert.equal(isReadOnlyCommand(command, "powershell"), true);
    });
  }

  for (const command of [
    // 当成 bash 转义就会把分隔符吃掉，让第二条命令混进同一个词
    "Get-ChildItem C:\\; Remove-Item -Recurse -Force C:\\data",
    "Get-Content C:\\|Remove-Item -Force x",
    "Get-ChildItem C:\\ ; Remove-Item x",
    "Where-Object -FilterScript { Remove-Item x }",
  ]) {
    it(`阻断：${command}`, () => {
      assert.equal(isReadOnlyCommand(command, "powershell"), false);
    });
  }
});
