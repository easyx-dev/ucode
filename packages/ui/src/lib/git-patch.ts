/**
 * 结构化 hunk → patch 文本：`@git-diff-view/react` 的输入形态。
 *
 * 服务端已经把 diff 解析成 hunk（含头部与每行的两侧行号），这里只把它还原成 patch 文本，
 * 契约与「谁解析」都不用改——客户端不重跑比对。
 *
 * 注意库的 `hunks` 参数不是「行数组」：它的每个元素都会被当成**一段完整的 diff** 交给解析器
 * （GitHub 的 unified diff parser），所以整段拼好、只给一个元素。带上 `---` / `+++` 两行
 * 让解析器先吃到文件头，语言推断也就有了依据。
 */
import type { GitHunk } from "@ucode/contracts";

/** 行首标记：新增 `+`、删除 `-`、上下文一个空格 */
const PREFIX: Record<GitHunk["lines"][number]["kind"], string> = {
  add: "+",
  del: "-",
  ctx: " ",
};

/** 仓库相对路径 → 一整段 patch 文本 */
export const hunkPatchText = (file: string, hunks: readonly GitHunk[]): string =>
  [
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks.flatMap((hunk) => [
      hunk.header,
      ...hunk.lines.map((line) => `${PREFIX[line.kind]}${line.text}`),
    ]),
  ].join("\n");
