# 阶段 8 · 会话分叉（及后续阶段顺序）

> 计划母文档：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 7「后续」。
> 参考：pi `SessionManager` 的条目树 / 分支能力（0.99.1），opencode `task` 与 [zcode 编辑历史](https://zcode.z.ai/cn/docs/edit-history)。
>
> 状态：**设计已定稿**。本文记录已定的路线与顺序，并给出「会话分叉」阶段的落地方案；
> 落地实现时在实现会话里补母文档「进度」表、新建 `plans/stage-8-session-fork.md` 并更新 `CHANGELOG.md`。

## 一、本轮决定

### 1.1 子智能体不再放开嵌套（7c-1d-c 收尾）

- **决定：不放开嵌套，维持单层**（`SUBAGENT_MAX_DEPTH = 1`，即只有根会话能派子会话）。
- 因此 7c-1d-c 的「深度 / spawn 预算 / 交互沿父链解析到根」**全部不做**：这些只在存在二级以上会话时才有意义；
  单层下父即根，现有实现已经正确。
- 「7c-1 · 子智能体」以 7c-1a ~ 7c-1d-b 收尾，7c-1d-c 标为**暂缓（不做）**；7c-1d-d（fork 口子）并入本阶段。
- 依据：opencode 的 `subagent_depth` **默认也是 1**，嵌套是显式 opt-in，且其嵌套场景下的交互路由仍有未修的挂起缺陷
  （issue #13715）。收益集中在少数长任务，代价正好落在交互路由、嵌套进度与成本控制这三个最难验证处。
- 若将来要放开，按本节保留的语义实现即可：深度为**会话绝对深度**（根 = 0，`depth >= 上限` 即禁派），
  能力沿 `parentSessionId` 链递归取交集。

### 1.2 后续阶段顺序（已定）

`会话分叉 → 编辑历史 → 使用统计 → goal 模式`

| 序号 | 阶段 | 一句话 | 依赖 |
| --- | --- | --- | --- |
| 8 | 会话分叉 | 从某条消息分出新会话，可继续对话，带来源链接 | pi `SessionManager` |
| 9 | 编辑历史 | 编辑已发消息并重发，旧分支保留 | 复用阶段 8 的 `agent/fork/` 原语 |
| 10 | 使用统计 | 每轮 token / 用量落 SQLite + 展示 | `message_end` / `agent_settled` 钩子 |
| 11 | goal 模式 | `/goal <目标>`，每轮自动校验、未达成自动续跑 | 复用模式层；用量上限依赖阶段 10 |

> 「使用统计」排在 goal 之前，是因为 goal 的「用量上限」需要它。

## 二、阶段 8 · 会话分叉

### 2.1 目标与范围

**目标**：用户能在一条已落盘消息上「从此分叉」，生成一个**独立的新会话**（普通顶层会话，可继续对话），
内容为该消息及其之前的历史；原会话不变；两者之间有来源链接。

**pi 提供的接缝（已核对 0.99.1 `dist/core/session-manager.d.ts`）**：

| 能力 | API | 用途 |
| --- | --- | --- |
| 从某节点抽出新会话文件 | `createBranchedSession(leafId)` | 本阶段核心：取 root→该节点路径写成新 JSONL，header 里 `parentSession = 源文件路径`，返回新文件路径，新 id 由 pi 生成（uuidv7） |
| 条目路径 / 叶子 | `getBranch(entryId)` / `getLeafId()` / `getEntry(id)` | 校验分叉点、取默认点 |
| 原地分叉（不新建文件） | `branch(entryId)` | 阶段 9 编辑历史用，本阶段不用 |
| 整体拷贝 | `forkFrom(source, cwd, dir, { id })` | 本阶段**不用**（它拷整棵树，不是「到某节点」） |

消息 DTO 的 `id` 就是 pi 的条目 id（`core/serialize.ts` 直接以 `entry.id` 作 DTO id），
前端点哪条消息就能把哪个 id 传给分叉接口，不需要另做映射。

**明确不做**（留后续）：

- `/clone`（复制当前活动分支）——母文档已标「暂不做」。
- 「连文件一起重置」——属阶段 9 编辑历史。
- 子智能体 `fork` 上下文的接线——复用本阶段 `agent/fork/` 原语，但本阶段不接。
- 不改 pi 条目树；分叉只做「提取 root→节点」。

### 2.2 已锁定的决策

1. **分叉点语义**：含所选那条消息（`createBranchedSession` 的原生语义）。默认（不传 `fromEntryId`）取当前叶子。
2. **新会话 cwd**：继承源会话**解析后的实际目录**（未绑定源 → 继承源的工作区绝对路径，两边共用同一目录），
   避免「转录 header 里的 cwd 与新会话实际 cwd 不一致」。
3. **来源存储**：DB 新列 `forked_from_session_id`（而非只读 header 的 `parentSession`），文件删了也不丢来源。
4. **只允许主会话分叉**：子智能体会话只读、且没有独立模式语义，不允许作为分叉源（返回 400）。
5. **命名**：源有名字 → `<源名> · 分叉`；源无名字 → 留空（列表预览自然带出）。

### 2.3 server 改动

- **`server/src/agent/fork/index.ts`（新，共享原语）**：`forkSession(services, input) → SessionSummary`，
  语义为「给定源会话 + 分叉点 → 新会话文件 + 会话级父链接」。步骤：
  1. 校验源会话存在、未归档、**未在跑**（`pool.isActive` → 409 `session_busy`）、已落盘（`sourcePath` 非空）、是主会话。
  2. **另开一个 throwaway `SessionManager.open(sourcePath, env.sessionsRoot, cwd)`** 调 `createBranchedSession`；
     绝不能用池里的实时 manager（会把源会话的 manager 切走）。
  3. 解析分叉点：`fromEntryId` 缺省用 `getLeafId()`；用 `getEntry` / `getBranch` 校验其存在且路径里至少有用户消息，否则 400。
  4. `createBranchedSession(entryId)` → 读回 `getSessionId()` / `getSessionFile()`。
  5. 落 DB 行：继承源会话解析后的 `cwd` / `mode` / `model` / `thinkingLevel`；写 `forked_from_session_id = 源 id`；名称按 2.2-5 生成。
  6. 用新 manager 回写索引（preview / 时间），返回摘要。
- **`db/index.ts`**：`SCHEMA_VERSION` 2 → 3，迁移 3 `ALTER TABLE session ADD COLUMN forked_from_session_id TEXT;`（开发期直接删 `app.db` 重建）。
- **`db/session-repository.ts`**：`SESSION_COLUMNS` / row schema / `toRecord` / `SessionRecord` 增 `forkedFromId`；新增 `createForked(...)`。
- **`routes/sessions/index.ts`**：`POST /fork`，`ok(forkSession(...))`。
- **`core/serialize.ts`**：两个摘要构造点（`draftSessionSummary` / `sessionInfoToDTO`）补 `forkedFromId`。
- pool / `resolveAgent` **不改**：分叉会话是普通主会话（`parent_session_id` 仍为空，不进子树）。

### 2.4 契约 & DB

- `sessions/input.ts`：`sessionForkInputSchema = { sessionId, fromEntryId?: string, name?: string }`
  （`fromEntryId` 服务端对着条目树校验，非法即 400）。
- `sessions/output.ts`：`SessionSummary` 增 `forkedFromId: string | null`；分叉响应沿用扁平的 `SessionSummary`（与 `create` 一致）。
- 错误码复用 `notFound` / `sessionBusy` / `invalidRequest`，不新增。

### 2.5 前端

- 消息悬停操作区加「**从此分叉**」（运行中隐藏；只对已落盘消息显示）。
- 成功后：刷新列表 → 切到新会话（`?session=<newId>`）。
- 会话头部显示「分叉自「<源名>」」来源链接（点回源会话）；源名从列表取，取不到退化为 id。侧栏徽标先不做。
- i18n：`从此分叉` / `分叉自…` 等 key 中英齐平。

### 2.6 测试

- **单测**：分叉点校验（非法 / 越界 entry id）、cwd / mode / model 继承、写入 `forkedFromId`、
  列表仍只出根会话、源会话行不变。
- **集成（Hono `app.request`）**：fork 成功返回摘要；running → 409；未落盘 / 归档 / 非法点 → 可读错误且不留半成品；
  `sessions/info` 带出 `forkedFromId`。
- **浏览器走查**：从中间一条消息分叉 → 新会话含该消息及之前历史、可继续对话；原会话完好；来源链接可跳。

### 2.7 验收

- 从任一条已落盘消息分叉 → 新会话含该消息及之前历史，可继续对话；原会话不变。
- 分叉会话带 `forkedFromId`，UI 显示来源并可跳转。
- running / 未落盘 / 归档 / 非法分叉点分别给出可读错误，不产生半成品。
- 刷新后分叉会话仍在列表，来源链接保持。

### 2.8 风险与边界

- **复用 `agent/fork/` 原语**：阶段 9 的 `/tree` 原地分支与「子智能体 fork 上下文」都要用它，
  本阶段先把「源会话 + 分叉点 → 新会话文件 + 会话级链接」这层抽干净。
- **分叉的是单条路径**：`createBranchedSession` 只取 root→节点的活动路径，被压缩裁剪的旧条目不在新会话里（与 pi 口径一致）。
- **共用工作目录**：分叉会话与源共用 cwd，并发写同一目录的冲突风险与子智能体相同，靠提示词与用户约束，不做文件锁。
- **不落盘的会话不能分叉**：`sourcePath` 为空的草稿会话直接拒绝。

## 三、后续阶段概要（本轮只记意图，详细方案各阶段再定稿）

- **阶段 9 · 编辑历史**：编辑已发消息并重发；pi 的 `appendContextEdit(targetId, replacement)` 可在不改树的前提下替换早前条目的上下文，
  或用 `branch(entryId)` + 重发。参考 opencode / zcode 的「只作用于最近一轮用户消息」。
  「连文件一起重置」拆为可选子项，不做进首批。
- **阶段 10 · 使用统计**：`message_end` / `agent_settled` 钩子取 `Usage`，落 SQLite（新表），
  提供会话 / 全局聚合与展示；为阶段 11 的 goal 用量上限提供数据。
- **阶段 11 · goal 模式**：`/goal <目标>` 设当前会话目标，每轮落定后由一次校验模型调用判断是否达成，
  未达成自动开下一轮；支持查看 / 替换 / 暂停 / 恢复 / 清除；plan 模式下禁用；用量上限依赖阶段 10。
  参考 [zcode 目标模式](https://zcode.z.ai/cn/docs/goal) 与 [pi-goal](https://pi.dev/packages/@schovest/pi-goal)。

## 四、阶段 8 复盘（落地时的偏差）

- `agent/fork/index.ts` 只用 `SessionManager.open(sourcePath, undefined, cwd)`（**不传 sessionDir**），
  让新文件由 pi 从源文件父目录派生——线上源文件都在 `sessionsRoot` 下，结果一致；单测因此不会写到真实目录。
- **新会话继承源会话的生效值**（`override ?? 运行时默认`）而不是原样复制覆盖值，保证分叉后两边的模型 / 档位观感一致。
- 分段校验：未在跑 → 未归档且是主会话 → `sourcePath` 非空 → 分叉点存在且其分支里已有用户消息，
  任一步失败都抛可读 `AppError`（400），不留半成品文件。
- 界面：消息悬停出现「从此分叉」（仅主对话、仅已落盘消息）；头部来源链接「分叉自「…」」可点回源会话；
  源会话无名字时退化为 id（`name` 继承 `<源名> · 分叉`，源无名则留空）。
- 源会话前置校验抽成纯函数 `resolveForkSource`（未找到 / 子会话 / 在跑 / 未落盘 → 可读 `AppError`），
  路由只做编排；单测覆盖四类拒绝与放行。落行失败会清掉刚写出的分叉文件，避免孤儿。
- 验收：`pnpm check` 全绿（**208 单测** + 6 项约定校验）。真实服务 E2E（curl）——
  建会话跑两轮 → 从首条用户消息分叉得 1 条消息、从叶子分叉得 4 条消息、`forkedFromId` 正确、
  源会话未被改动、非法分叉点 400。`agent-browser` 走查——消息悬停出现分叉按钮、点击后切到新会话且
  URL / 侧栏更新、头部来源链接显示并可跳回源会话。
- 已知边界：分叉的是单条活动路径（被压缩裁剪的旧条目不在新会话里，与 pi 口径一致）；
  分叉会话与源共用 cwd，不做文件锁；`running` 时前端隐藏按钮、服务端 409 兜底。
  源会话的「未在跑」检查与读取文件之间仍有并发窗口（单用户场景概率极低，先记录不额外加锁）；
  `createForked` 落行失败时会清掉刚写出的分叉文件，避免孤儿。
