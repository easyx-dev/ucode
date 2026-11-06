---
description: 落版、打 tag 并推送，触发 npm 发布
---

把当前分支走完「落版 → 打 tag → 推送」。推送 `v*` tag 即触发 `.github/workflows/release.yml` 发布到 npm。
**调用本命令即视为用户已授权提交、打 tag 与推送**（AGENTS.md 默认禁止私自提交），不要再确认一次。

版本：$ARGUMENTS
（为空时按 `CHANGELOG.md` 未发布段的内容自行判定升哪一位，直接按判定执行、不再追问。0.x 阶段的升位口径：
新增 / 变更走 `minor`，只有修复走 `patch`，破坏性变更仍是 `minor`——0.x 没有 `major`。给了 `patch` /
`minor` / `major` 或具体版本号（如 `0.3.1`）就照它来。）

## 步骤

1. **前置核对**：`git fetch origin` 后确认四件事——在 `v0`（`pnpm-workspace.yaml` 的 `publishBranch`）上、
   不是分离头指针、工作区干净、本地未落后于 `origin/v0`。任一条不满足就停下说明原因与建议的下一步
   （落后时由用户决定合并还是变基），不要自动 stash / merge / rebase。
2. **落版**：`CHANGELOG.md` 的 `## [未发布]` 改成 `## [<版本>] - <YYYY-MM-DD>`，按文件顶部的规模上限与
   归档规则处理明细（达到阈值就整体移入 `docs/changelog/<年份>.md`，主文件只留 ≤ 16 条摘要 + 一行链接）；
   最上面补回一个空的 `## [未发布]` 供下次累积。不新增未发布段里没有的条目。
3. **改版本号**：根 `package.json` 的 `version` 与 tag 必须逐字一致（CI 第一道闸核对的就是它）。
4. **跑检查**：`pnpm check`（一轮只跑一次，放在最后一次改动之后）。失败就停下报错，不跳过、不带病打 tag
   ——发布 job 不再重复检查，tag push 上的 `check.yml` 是另起的 run，拦不住这次发布。
5. **提交**：只提交落版涉及的改动——根 `package.json` 的版本号、`CHANGELOG.md`，以及按第 2 步归档到
   `docs/changelog/<年份>.md` 的明细（可能是新建文件，漏了它提交里就是半份改动）。提交信息
   `chore(release): <版本>`，不用 `--amend`，不夹带其它改动，不手工 `pnpm publish`（本地发布没有
   provenance，正常路径就是打 tag）。
6. **打 tag**：`git tag v<版本>`。同名 tag 在本地或 `origin` 上已存在就停下报告，不删除、不覆盖。
   该版本已在 registry 上（`npm view @easyx-dev/ucode@<版本> version` 确实打印出版本号）就换一个版本，
   不强行发；命令本身失败（离线 / 未登录）按「查不到」处理，交给 CI 的第一道闸兜底。
7. **推送**：先 `git push origin HEAD`，再 `git push origin v<版本>`（顺序反了会让 tag 指到未推送的提交）。
   禁止 `--force`；不推送其它分支，不动 `hub/` 子模块指针。
8. **回报**：一行给出版本、tag 与远端分支，附 CI 地址 `https://github.com/easyx-dev/ucode/actions`。
   发布结果由用户在 CI 上确认，你不要轮询等它跑完。
