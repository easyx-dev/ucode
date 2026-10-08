# 会话条目

`$APP_HOME/harness/sessions/*.jsonl` 是会话的事实源：**只追加、不重写**，条目树靠 `parentId` 串起来，
分叉与「编辑并重发」只是切分支，旧条目仍在文件里。本文档登记「有哪些条目、各自 payload 是什么、
进不进模型上下文、界面展不展示、谁写谁读」——加新条目时在这里加一行，`scripts/verify` 会双向校验。

两条容易踩的语义：

- **压缩只裁剪「模型看到的视图」**：`buildSessionProjection()` 之后，被摘要覆盖的条目对模型不可见，
  但**文件里一条不少**。所以「回溯」= 直接扫 JSONL（`grep` / 脚本），「界面」= 走 `messages/list`
  的 DTO（只出当前分支、且只到最新压缩点之后）。两者口径不同，别混。
- **`custom` 与 `custom_message` 是两件事**：前者只作扩展状态持久化、**不进模型上下文**；后者会转成一条
  user 文本进上下文（`convertToLlm` 不额外包裹），用来注入内容。只为回溯、观测用的记录一律用 `custom`。

界面是否可见由 `server/src/core/serialize.ts` 的 `entryToDTO` 白名单决定：**默认不下发**，
只有明确要展示的条目才带 `customType` 出去。

## pi 自带的条目

| 条目 | 进上下文 | 我们的用法 | 界面 |
| --- | --- | --- | --- |
| `message` | 是 | 用户 / 助手 / 工具结果，会话主体 | 展示 |
| `compaction` | 摘要进，被覆盖的不进 | 压缩点，`firstKeptEntryId` 标出保留起点 | 展示成分隔条 |
| `custom_message` | 是（转 user 文本） | 合成输入，见下表 | 按 `customType` 决定 |
| `custom` | 否 | 本项目的观测与状态记录，见下表 | 白名单放行 |
| `context_edit` | 是（改写目标条目的内容） | 旧工具输出清理（prune）写它 | 不展示 |
| `usage` | 否 | pi 记的每轮用量 | 不展示（用量面板另走统计） |
| `model_change` / `thinking_level_change` | 是（作为边界） | 模型 / 思考档位切换 | 不展示 |
| `label` / `session_info` / `branch_summary` | 否 / 视情况 | 暂未使用 | 不展示 |

## 本项目的条目

| customType | 类型 | payload | 写入点 | 界面 |
| --- | --- | --- | --- | --- |
| `ucode.step` | custom | `{ turn, startedAt, firstTokenAt, respondedAt, endedAt, ttftMs, streamMs, toolMs, userWaitMs, toolCalls, inputTokens, cacheReadTokens, outputTokens, reasoningTokens, contextTokens, contextBudget, attachments }`（时间字段是毫秒时间戳） | `server/src/harness/telemetry` | 不展示 |
| `ucode.permission-decision` | custom | `{ tool, subject, scope, decision, sourceSessionId?, sourceDescription? }` | `server/src/core/pool.ts` | 展示成审批记录 |
| `ucode.compaction` | custom | `{ reason, outcome, tokensBefore?, tokensAfter?, keptFrom?, skip?, error?, at }`（`reason` 取 `manual` / `threshold` / `overflow`，`outcome` 取 `done` / `skipped` / `failed`） | `server/src/core/pool.ts` | 展示成压缩分隔行 |
| `ucode.goal` | custom | `{ event, status?, cause?, turns?, verdict?, tokensUsed?, objective?, at }`（`event` 取 `set` / `pause` / `resume` / `clear` / `verdict` / `completed`） | `server/src/harness/goal` | 只展示 `completed`（目标完成细线） |
| `ucode.goal-prompt` | custom_message | 正文是注入的目标指令；`details` 为 `{ kind: kickoff \| continuation \| resume, turn? }` | `server/src/core/pool.ts`、`server/src/core/run.ts` | 展示成细线（目标启动 / 续跑 / 恢复） |
| `ucode.plan-approved` | custom_message | 正文是「计划已批准，请开始执行。」 | `server/src/core/run.ts` | 展示成细线（计划已批准） |
| `ucode.plan-ignored` | custom | `{ at }` | `server/src/routes/messages` | 展示成「已忽略计划」 |
| `ucode.mode` | custom | `{ mode?, permissionMode?, at }`（至少一个变更项） | `server/src/routes/sessions` | 展示成细线（模式 / 权限档位已切换） |
| `ucode.prune` | custom | `{ cleared, freedTokens, targets: Array<{ id, tool }>, at }` | `server/src/core/pool.ts` | 不展示 |
| `ucode.subagent` | custom | `{ event, childId, toolCallId, agent?, name?, isError?, aborted?, at }`（`event` 取 `start` / `end`） | `server/src/core/pool.ts` | 不展示 |
| `ucode.interaction` | custom | `{ kind, requestId, outcome, sourceSessionId?, at }`（`kind` 取 `permission` / `question`，`outcome` 取 `resolved` / `dismissed` / `aborted`） | `server/src/app.ts` | 不展示 |
| `ucode.memory-review` | custom | `{ file, title, at }` | `server/src/harness/memory` | 不展示 |

`decision` 取值见契约的 `PERMISSION_DECISIONS`（`allow_once` / `allow_session` / `deny`）；
`ucode.goal` 的 `cause` 取值见 `GOAL_PAUSE_CAUSES`。

## 约定

- 命名一律 `ucode.` 前缀加 kebab-case；常量写在 `packages/contracts/src/constants.ts`（跨端常量，
  值即条目里的 `customType`），并与本文档的表格逐条对齐——`scripts/verify` 双向校验。
- payload 字段 camelCase（与 `docs/api.md` 的字段命名同口径）；时间用 `at`（ISO 8601 字符串），
  只有 `ucode.step` 是热路径，用毫秒时间戳避免每步两次格式化。
- 只为回溯 / 观测的条目**不进** `serialize` 白名单，只在文件里；要上界面的条目必须在「界面」列写明形态。
- 条目是追加语义：可以加字段，但不要改老字段的含义——看历史的人只能靠这一列对齐口径。
- 排查时先按 `customType` 过滤，例如：

  ```bash
  grep -h '"customType":"ucode.step"' "$APP_HOME"/harness/sessions/*.jsonl
  ```
