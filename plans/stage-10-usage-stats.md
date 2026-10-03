# 阶段 10 · 使用统计

> 计划母文档：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 7「后续」与阶段 10 概要。
> 参考：opencode `cli/cmd/stats.ts`（逐会话读消息记录现算）、[zcode 使用统计](https://zcode.z.ai/cn/docs/usage-stats)（统计本地会话记录）。
>
> 状态：**已完成**（`297eb00`）。本轮定稿的关键取舍：**不建表**，从 pi 会话记录（JSONL）现算 + 内存缓存；
> 只用 token 不计成本；子会话 / 分叉计入全局并标注来源。

## 一、目标与范围

**目标**：把每次 LLM 调用的 token 用量从 pi 的会话记录聚合出来，提供会话级与全局展示，为阶段 11 goal 的用量上限提供「按会话 + 时间范围」的数据。

**做**：

- 会话级：对话区头部显示本会话累计 token，随每轮落定刷新。
- 全局：统计对话框展示总量、按模型、按会话（标注主会话 / 子会话 / 分叉）与工具调用次数，支持全部 / 30 天 / 7 天。

**明确不做**：

- **不新增 DB 表**：用量已在 pi 的 JSONL 里（assistant 消息的 `usage`、独立 `usage` 条目、compaction / branch_summary 的 `usage`），
  再落一张表等于复制事实源，还要引入迁移、幂等、回填、同步四类复杂度。opencode / zcode 也都是从消息记录现算。
- 不做消息级用量展示（pi 的 `Usage` 已在条目里，随时可加）。
- 不展示成本（`Usage.cost` 不参与统计）。
- 不做远端套餐额度（zcode 的「编程套餐」依赖服务商，超出本仓库范围）。

## 二、已锁定的决策

1. **数据源是会话记录**：实时与离线统一走「读条目 → 聚合」，口径与 pi `getSessionStats()` 一致
   （合计 = `input + output + cacheRead + cacheWrite`）。
2. **内存缓存**：按会话文件 `(mtimeMs)` 缓存解析出的用量点（每个 LLM 调用 / usage 条目一条），
   未变化的文件不重读；不落库。
3. **只统计 token**：契约里没有 cost 字段。
4. **归属**：子智能体会话（有 `parentSessionId` / `agent`）与分叉会话（有 `forkedFromId`）都计入全局，
   在 `bySession` 里用 `kind` 标注；归档会话计入（软删只隐藏列表）。
5. **时间范围**：按条目时间戳过滤，`since` 由 `days` 换算；同时作为阶段 11 goal 用量上限的查询基础。

## 三、数据源与 pi 接缝

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| assistant 消息 | `entry.type === "message"` 且角色 `assistant` | `entry.message.usage`，另带 `provider` / `model` |
| 独立用量条目 | `entry.type === "usage"` | `entry.usage` + `kind` / `provider` / `model`（如 `cache_warm`） |
| 压缩 / 分支总结 | `entry.type === "compaction"` / `"branch_summary"` 的 `usage` | 摘要调用本身的开销 |
| 工具调用次数 | assistant 消息 content 里的 `toolCall` 块 | 对齐 opencode 统计的工具维度 |

实时（池内）会话直接读 `session.sessionManager.getEntries()`，避免每次 `sessions/info` 都重解析整份会话文件；
离线 / 已回收会话才 `SessionManager.open(sourcePath)` 读条目。两者都经同一条纯函数聚合，口径一致。

## 四、契约（packages/contracts）

- 新增 `stats/output.ts`：
  - `UsageTotals = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens }`（无 cost）。
  - `ModelUsage = { provider, model, totals }`。
  - `SessionUsageEntry = { sessionId, name, kind: "primary" | "subagent" | "forked", deletedAt, totals }`（归档会话计入并标注，界面据此禁止打开）。
  - `StatsSummaryResponse = { total: UsageTotals; toolCalls: number; byModel: ModelUsage[]; bySession: SessionUsageEntry[] }`。
- 新增 `stats/input.ts`：`statsSummaryInputSchema = { days?: number }`（正整数；缺省 = 全部时间）。
- `sessions/output.ts`：`SessionInfoResponse` 追加 `usage: UsageTotals`（头部徽标一次请求拿到）。
- 不新增错误码。

## 五、server 改动

- **新文件 `server/src/agent/usage/index.ts`**：
  - 纯函数 `collectUsage(entries, since?)` → `{ totals, byModel, toolCalls }`，安全读取 `usage`（非数字按 0）。
  - `UsageService`：`usageOf(record, { live?, since? })`（池内会话读内存条目，否则读文件 + mtime 缓存）、
    `summary(days?)`（遍历 `sessions.list()` 汇总、按 `kind` 标注、合并模型维度）。
  - 读文件失败（在写、截断）按上一次缓存或 0 处理，不抛错，保证展示路径不打断接口。
- **`server/src/app.ts`**：装配 `UsageService`（复用同一仓储），加入 `Services`。
- **`server/src/routes/stats/index.ts`（新）**：`POST /stats/summary`。
- **`server/src/routes/sessions/index.ts`**：`describeSession` 带上 `usage`。
- **`server/src/index.ts`**：挂载 `/stats`。
- **无 DB / schema 变更**，`docs/database.md` 不动。

## 六、前端改动

- `lib/api.ts`：`stats.summary`；`lib/types.ts` 补契约出口。
- `hooks/use-usage.ts`（新）：按 `days` 取全局摘要；`hooks/use-session-usage.ts`（新）：按会话取 `sessions/info.usage`，
  会话切换与 `agent_settled`（生成落定）后刷新。
- `chat-header.tsx`：会话用量徽标（紧凑格式，如 `12.3k`），点击打开统计对话框。
- `components/usage-dialog.tsx`（新）：范围切换（全部 / 30 天 / 7 天）、总量与四类 token、按模型、按会话（可点开源会话）、工具调用次数。
- i18n：`使用统计` / `本会话用量` / `输入` / `输出` / `缓存读` / `缓存写` / `合计` / `按模型` / `按会话` / `工具调用` / `全部时间` / `最近` /
  `暂无用量` 等，中英齐平。

## 七、测试方案

**L2 单元**（`server/src/agent/usage/__tests__/usage.test.ts`，用真实 `SessionManager` 在临时目录造条目）：

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| U-01 | assistant / usage / compaction 三类条目的用量 | 全部计入，合计口径正确 |
| U-02 | 同一模型的多次调用 | 归并到同一模型键 |
| U-03 | `since` 过滤 | 只统计其后的条目 |
| U-04 | 非数字 / 缺失 usage | 按 0 处理，不抛错 |
| U-05 | 工具调用次数 | 按 assistant 消息的 `toolCall` 块计数 |
| U-06 | 归档会话 | 计入全局、带 `deletedAt`、`kind` 正确 |

**L3 集成（Hono `app.request`）**：`stats/summary` 返回总量与分组；`sessions/info` 带 `usage`；
非法 `days` 校验为 `invalid_request`。

**L5 浏览器走查（`agent-browser`）**：头部徽标出现并随生成刷新；统计对话框范围切换、按模型 / 按会话渲染。

## 八、验收

- 跑一轮后头部徽标显示本会话 token；刷新后保持。
- 统计对话框能看全局总量、按模型、按会话（含子 / 分叉标注）与工具调用次数，切换时间范围结果变化。
- 会话不存在 / 非法 `days` 给出可读错误；读损坏文件不打断接口。
- `pnpm check` 全绿。

## 九、风险与边界

- **全局扫描成本**：首次汇总要读多个 JSONL；mtime 缓存兜住重复查询。opencode 同样是扫描，会话数超 1000 时会明显变慢。
- **口径**：与 pi `getSessionStats()` 对齐；`cost` 不入统计，goal 上限按 token 计。
- **实时性**：正在流式生成的那条 assistant 消息落盘后才计入（`agent_settled` 后刷新），显示略滞后于界面文本。
- **删库无影响**：用量直接来自 JSONL，不依赖 `app.db`。

## 十、落地顺序

1. 契约 → 2. `agent/usage/` 纯函数 + 单测 → 3. `app.ts` 装配 + 路由 + `sessions/info.usage` →
4. 前端 api / hooks / 徽标 / 对话框 / i18n → 5. `CHANGELOG.md` → 6. 更新母文档进度表 →
7. `pnpm check` + curl E2E + `agent-browser` 走查 → 停下等 review。

## 十一、复盘（落地时的偏差）

- **实时会话走内存**：原计划「实时与离线统一读文件」，实现改为池内会话直接读 `session.sessionManager.getEntries()`。
  原因是 `sessions/info` 会被前端在**每次切换会话与每轮落定后**调用，读文件等于每轮重解析整份 JSONL（单进程同步 I/O）。
  离线 / 已回收会话仍走文件 + mtime 缓存。
- **归档会话**：统计里计入（软删只隐藏列表），但全局对话框原会把它渲染成可点开的按钮——点击后
  `useActiveSession` 见 `deletedAt` 会清空当前会话。契约 `SessionUsageEntry` 因此补 `deletedAt`，
  界面把归档项置灰、加「已归档」徽标并禁用点击。
- **`collectUsage` / `Aggregate`**：仅供单测使用而导出；本轮已收敛 `Aggregate` 为非导出类型。
- **未做**：L3 的 `app.request` 集成测试（当前只覆盖 L2 单测 + 真实服务 curl）；`stats/session` 独立端点
  （`usageOf(record, { since })` 已具备该能力，留待阶段 11 goal 按需接线）。
