# 会话条目

`$APP_HOME/harness/sessions/*.jsonl` 是会话的事实源：**只追加、不重写**，条目树靠 `parentId` 串起来，
分叉与「编辑并重发」只是切分支，旧条目仍在文件里。本文档登记「有哪些条目、各自 payload 是什么、
进不进模型上下文、界面展不展示、谁写谁读」——加新条目时在这里加一行，`scripts/verify` 会双向校验。

三条容易踩的语义：

- **压缩只裁剪「模型看到的视图」**：`buildSessionProjection()` 之后，被摘要覆盖的条目对模型不可见，
  但**文件里一条不少**。所以「回溯」= 直接扫 JSONL（`grep` / 脚本），「界面」= 走 `messages/list`
  的 DTO（只出当前分支、且只到最新压缩点之后）。两者口径不同，别混。
- **`custom` 与 `custom_message` 是两件事**：前者只作扩展状态持久化、**不进模型上下文**；后者会转成一条
  user 文本进上下文（`convertToLlm` 不额外包裹），用来注入内容。只为回溯、观测用的记录一律用 `custom`。
- **条目是审计事实，不回写应用状态**：`app.db` 是应用状态（名称 / 模式 / 权限档位 / 目标……）的**唯一**真值，
  写入方只有应用侧接口；会话文件里的对应记录（`ucode.mode` / `ucode.goal` / `ucode.permission-decision` 等）
  只用于回溯与展示。写点通常滞后于用户操作（切了还没跑，文件里还是上一轮的参数），拿条目回写会造出第二个
  真值源，顺序反过来一次就会把刚做的操作吞掉——模式 / 权限档位被回退就是这么来的。

界面是否可见由 `server/src/harness/pi/serialize.ts` 的 `entryToDTO` 白名单决定：**默认不下发**，
只有明确要展示的条目才带 `customType` 出去。

## pi 自带的条目

| 条目 | 进上下文 | 我们的用法 | 界面 |
| --- | --- | --- | --- |
| `message` | 是 | 用户 / 助手 / 工具结果，会话主体 | 展示 |
| `compaction` | 摘要进，被覆盖的不进 | 压缩点，`firstKeptEntryId` 标出保留起点 | 展示成分隔条 |
| `custom_message` | 是（转 user 文本） | 合成输入，见下表 | 按 `customType` 决定 |
| `custom` | 否 | 本项目的观测与状态记录，见下表 | 白名单放行 |
| `context_edit` | 是（改写目标条目的内容） | 旧工具输出清理（prune）写它 | 不展示 |
| `usage` | 否 | pi 记的每轮用量，含目标校验调用记的 `goal_verify` 一条 | 不展示（用量面板另走统计） |
| `model_change` / `thinking_level_change` | 是（作为边界） | 模型 / 思考档位切换 | 不展示 |
| `label` / `session_info` / `branch_summary` | 否 / 视情况 | 暂未使用 | 不展示 |

## 本项目的条目

| customType | 类型 | payload | 写入点 | 界面 |
| --- | --- | --- | --- | --- |
| `ucode.step` | custom | `{ turn, userTurn, startedAt, firstEventAt, firstTokenAt, respondedAt, endedAt, firstEventMs, ttftMs, streamMs, toolMs, userWaitMs, toolCalls, toolNames, hasText, inputTokens, cacheReadTokens, outputTokens, reasoningTokens, contextTokens, contextBudget, thinkingLevel, provider, model, stopReason, attachments }`（时间字段是毫秒时间戳） | `server/src/harness/features/telemetry` | 不展示 |
| `ucode.permission-decision` | custom | `{ tool, subject, scope, decision, sourceSessionId?, sourceDescription? }` | `server/src/core/pool.ts` | 展示成审批记录 |
| `ucode.compaction` | custom | `{ reason, outcome, tokensBefore?, tokensAfter?, keptFrom?, skip?, error?, at }`（`reason` 取 `manual` / `threshold` / `overflow`，`outcome` 取 `done` / `skipped` / `failed`） | `server/src/core/pool.ts` | 展示成压缩分隔行 |
| `ucode.goal` | custom | `{ event, status?, cause?, turns?, turnTokens?, turnToolCalls?, turnMs?, verdict?, tokensUsed?, objective?, at }`（`event` 取 `set` / `pause` / `resume` / `clear` / `budget` / `verdict` / `completed`）；`turnTokens` 是本轮用量增量（含本轮校验开销），`turnToolCalls` / `turnMs` 是本轮的调用数与耗时 | `server/src/harness/features/goal` | `completed` 并进它那一轮的分隔行，找不到开轮条目时才单独成线；其余不展示 |
| `ucode.goal-prompt` | custom_message | 正文是注入的目标指令；`details` 为 `{ kind: kickoff \| continuation \| resume, turn? }` | `server/src/core/pool.ts`、`server/src/services/sessions/run.ts` | 展示成细线（目标启动 / 续跑 / 恢复） |
| `ucode.plan-approved` | custom_message | 正文是「计划已批准，请开始执行。」 | `server/src/services/sessions/run.ts` | 展示成细线（计划已批准） |
| `ucode.plan-ignored` | custom | `{ at }` | `server/src/routes/messages` | 展示成「已忽略计划」 |
| `ucode.mode` | custom | `{ mode?, permissionMode?, at }`（至少一个变更项） | `server/src/core/pool.ts`（轮起点 `recordRunSettings`） | 不展示：审计「这一轮跑在什么参数下」（写侧靠它去重）；**不回读** |
| `ucode.skill` | custom | `{ event, name, file, source, toolCallId?, at }`（`event` 取 `invoke` / `hit`，`source` 取 `COMMAND_ASSET_SOURCES`） | `server/src/core/pool.ts`、`server/src/services/sessions/run.ts` | 不单独成行：`hit` 挂在对应的 `read` 调用卡片上，`invoke` 只落文件 |
| `ucode.retry` | custom | `{ event, attempt, maxAttempts, delayMs?, errorMessage?, success?, at }`（`event` 取 `start` / `end`） | `server/src/core/pool.ts` | 展示成细线：`start` 与 `end(success: false)`；重试成功那条不下发 |
| `ucode.prune` | custom | `{ cleared, freedTokens, targets: Array<{ id, tool }>, at }` | `server/src/core/pool.ts` | 不展示 |
| `ucode.subagent` | custom | `{ event, childId, toolCallId, agent?, name?, isError?, aborted?, at }`（`event` 取 `start` / `end`） | `server/src/core/pool.ts` | 不展示 |
| `ucode.interaction` | custom | `{ kind, requestId, outcome, sourceSessionId?, at }`（`kind` 取 `permission` / `question`，`outcome` 取 `resolved` / `dismissed` / `aborted`） | `server/src/app.ts` | 不展示 |
| `ucode.memory-review` | custom | `{ file, title, at }` | `server/src/harness/features/memory` | 不展示 |

`decision` 取值见契约的 `PERMISSION_DECISIONS`（`allow_once` / `allow_session` / `deny`）；
`ucode.goal` 的 `cause` 取值见 `GOAL_PAUSE_CAUSES`（`blocked` 由模型调 `goal_blocked` 报的受阻）。

## 约定

### 用户消息的正文形状

一条用户消息的正文（`message` 条目里 user 角色的 `content` 文本）不是用户原话本身，而是
「注入内容的边界块 + 用户原话」拼成的，顺序固定（见 `server/src/services/sessions/run.ts` 的 `composeText`）：

```
<skill name="…" location="…">…</skill>   ← `/skill:name` 展开的技能正文（可选）
<command name="…" args="…">…</command>  ← `/name args` 展开的提示词命令正文（可选）
<context path="…" lines="…">…</context> ← `@` 引用读到的内容，一条一个块（可多条）
用户原话                                  ← 正文，各类位置标记在里面
```

- 边界块的正文归服务端中和同名标签、属性转义（`harness/utils/boundary`），所以「匹配首个闭合标签」是安全的。
- 命令与技能由**服务端**展开（pi 的展开要求整条输入以 `/` 开头，而 `@` 引用拼在前面，交给 pi 会整条不展开），
  边界块同时是客户端认出「这是一条命令 / 技能」的唯一依据。
- `@` 引用的 `path` 是工作目录相对写法（编辑重发回传的也是它），服务端读内容时按会话工作目录解析。
- 编辑重发（`messages/edit`）走同一套投递口径：客户端把正文换算成同一套位置标记（见下）再投递。

### 正文里的位置标记

正文里的三类标记都是**位置**信息：客户端按文档里的节点顺序写，服务端按同一套字面量就地展开
（常量与扫描器在 `packages/contracts/src/messages/markers.ts`，两端共用）：

| 类型 | 载荷里的写法 | 会话条目里的形态 |
| --- | --- | --- |
| `@` 引用 | `@<路径>` | 不变 |
| 图片 | `图片 N`（N 按本条里图片的出现顺序，1 起） | 不变（图片本体按标记顺序附在文本之后） |
| 非图片附件 | `附件 N.<ext>`（扩展名取自文件名，认不出时省略） | 就地换成 `[附件: <显示名> (id: <sha256>)]` |

- 图片无法真正落在句子中间：pi 的 `prompt(text, images)` 只接受「一整段文本 + 图片数组」，
  图片标记只是给模型的位置提示，本体按顺序跟在文本之后。
- 服务端只在「标记与附件列表对得上」时内联展开：图片按 `图片 1..K`、非图片按 `附件 1..M`
  各自连续升序、数量一致，且写出的扩展名与该附件的扩展名相同。对不上（用户手打了同名标记、
  附件被删掉一个）就整段退回「引用行前置 + 图片按原顺序」的老路径，不去改用户写的话。
- 客户端回放靠 `packages/ui/src/business/composer/message-chips.ts` 的段落化解析：剥块 → 出 chip；正文里的
  `@<路径>`（只认前置块里出现过的路径，按最长匹配）、图片标记与附件引用行都就地还原成 chip，
  位置就是用户当初放的位置。没有标记的早期消息按老样子把图片排在气泡下方。

- 命名一律 `ucode.` 前缀加 kebab-case；常量写在 `packages/contracts/src/constants.ts`（跨端常量，
  值即条目里的 `customType`），并与本文档的表格逐条对齐——`scripts/verify` 双向校验。
- payload 字段 camelCase（与 `docs/api.md` 的字段命名同口径）；时间用 `at`（ISO 8601 字符串），
  只有 `ucode.step` 是热路径，用毫秒时间戳避免每步两次格式化。
- `ucode.step` 把一次模型往返拆成四段：`firstEventMs`（发出 → 响应头）→ `ttftMs`（响应头 → 首个
  内容帧）→ `streamMs`（首个内容帧 → `message_end`）→ `toolMs`（`message_end` → `turn_end`）。
  锚点取自 pi 的 `message_start` 与首个 `message_update`——它的 `start` 帧不会走 `message_update`。
  `hasText` 与 `toolNames` 用来事后区分「只有工具调用的执行步」与「有汇报的步」。
  **四段可加**：`firstEventMs + ttftMs + streamMs + toolMs = endedAt - startedAt`；其中
  `toolMs` 含等用户的时间，纯工具耗时 = `toolMs - userWaitMs`（等待起止可能跨轮，聚合时按下界 0 clamp）。
  `turn` 是本次装配内的往返序号（会话重装后归零），按用户输入分组要用 `userTurn`
  （由会话池在 run 入口推进，用户消息与目标续跑这类合成输入都算一轮）。
- 只为回溯 / 观测的条目**不进** `serialize` 白名单，只在文件里；要上界面的条目必须在「界面」列写明形态。
- 条目是追加语义：可以加字段，但不要改老字段的含义——看历史的人只能靠这一列对齐口径。
- 排查时先按 `customType` 过滤，例如：

  ```bash
  grep -h '"customType":"ucode.step"' "$APP_HOME"/harness/sessions/*.jsonl
  ```
