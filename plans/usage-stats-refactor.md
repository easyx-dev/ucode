# 使用统计重构：三层拆分、步级耗时聚合与缓存命中率

> 依赖：[`stage-10-usage-stats.md`](./stage-10-usage-stats.md)（已落地的旧方案，本文的出发点）、
> [`docs/session-entries.md`](../docs/session-entries.md)（`ucode.step`、`ucode.compaction` 的登记）、
> `server/src/harness/features/telemetry`（步级数据的写入方）。
>
> 状态：**未开始**（方案定稿，待实施）。

## 一、为什么重构

### 1.1 现状的四个问题

1. **一个类管三件事**：`harness/features/usage/index.ts:209-412` 的 `UsageService` 同时是「跨会话统计聚合」、
   「上下文占用的进程内瞬时状态」（`estimated` / `compactions` / `budgets` 三张内存表，`:216-228`）、
   「会话文件解析的 mtime 缓存」（`CachedSessionUsage`，`:197-206`）。三者的生命周期与失效条件都不同，
   却共用 `forget` / 一次构造。
2. **契约混装**：`packages/contracts/src/stats/output.ts` 里 `ContextUsage`（会话级瞬时值）与
   `StatsSummaryResponse`（区间历史聚合）挤在一起，前者其实跟着 `sessions/output.ts` 走。
3. **`ucode.step` 完全进不了统计**：`collectPoints`（`harness/features/usage/index.ts:106`）只认四类条目
   （assistant 消息 `:109`、`usage` `:125`、`compaction|branch_summary` `:137`），`custom` 一律跳过；
   `CachedSessionUsage`（`:197`）也只缓存 `points` + `contextTokens`。步级数据每步都在落盘，却没有任何
   读取方。
4. **维度只有 token 与次数**：`UsagePoint`（`:80`）是 `{ timeMs, provider, model, totals, toolCalls }`，
   没有耗时、没有步骤、没有缓存命中率；请求侧只有 `days`（`packages/contracts/src/stats/input.ts`），
   `bySession` 只有累计总量。

跨会话本身不是问题——`summary()`（`:313-376`）已经在遍历 `sessions.list()` 并输出
`byModel` / `bySession` / `daily` / `weekly` / `streak` / `peak`。缺的是**会话内维度**与**步级维度**。

### 1.2 目标

- 结构上把三件事拆开，让「解析」与「聚合」可单测、瞬时状态单独失效；
- 把 `ucode.step` 接进统计，产出「每轮步数 / 平均与分位每步耗时 / 首 token 占比 / 纯工具耗时占比 /
  按模型与思考档位分桶」；
- 在用量面板展示步级维度与**缓存命中率**（后者数据早已具备，见第七节）。

## 二、范围界定

| 场景 | 现状 | 本次 |
| --- | --- | --- |
| `ucode.step` 的写入时机 | 每步一条，`turn_end` 时 flush | 不变（只为聚合补三个字段，见第五节） |
| `StatsSummaryResponse` 的形状 | 已上线 | 只**加**字段，不改既有字段与口径 |
| `ContextUsage` 的归属 | 与统计同文件 | 迁到 `stats/context.ts`（类型不变） |
| 会话级 `usage` / `contextUsage`（`describeSession`） | 已上线 | 不变 |
| 用量口径 | 已上线 | 加一笔新开销：目标校验调用此前不入账，现在会落成 `usage` 条目（`kind = goal_verify`，见 `stage-11-goal.md`「十二、收口轮」）；字段与算法不变，但历史数据与之后的统计会有一层差異 |
| 实时性 | 会话级走 `session_updated` 帧 | 不变；步级与命中率走 HTTP 聚合接口，不新开实时通道 |
| 成本 | 只用 token、不计成本 | **不变**（`stage-10-usage-stats.md` 的定稿取舍） |
| `ucode.step` 下发界面 | 不下发（只在文件里） | 不变（聚合在服务端算，不把逐条记录推给客户端） |

## 三、已锁定的决策

1. **三层拆分，对外接口不变**：
   - 解析层：会话条目 → 用量点 / 步级点（纯函数，输入是条目数组）；
   - 聚合层：用量点集合 → 区间派生（纯函数）；
   - 运行期状态：上下文占用等瞬时值（有生命周期、要 `forget`）。
   `UsageService` 收窄成「文件读取 + mtime 缓存 + 对外方法」的门面，形状与调用点不变。
2. **契约按域拆**：`ContextUsage` 移到 `packages/contracts/src/stats/context.ts`，
   `stats/output.ts` 只留区间聚合模型。
3. **步级点与用量点并列**：缓存结构从 `{ points, contextTokens }` 扩成
   `{ points, steps, contextTokens }`，仍按 `(path, mtimeMs)` 缓存，读失败沿用上一次结果的行为不变。
4. **步级聚合只加在全局统计里**：`StatsSummaryResponse` 新增步级维度；会话级不新增接口，
   面板的步级区用同一份响应。
5. **缓存命中率是展示层派生**：分子分母都已经在每个 `UsageTotals` 里，不加契约字段（第七节）。

## 四、目标结构

```
server/src/harness/features/usage/
├── parse.ts        （新）条目 → 用量点 / 步级点；readUsage、entryTimeMs、countToolCalls、contextTokensOfBranch
├── aggregate.ts    （改）纯派生：现有的分桶 / 连续天数 / 时长 + 新增步级聚合
├── context.ts      （新）上下文占用的运行期状态：estimated / compactions / budgets 与 contextUsageOf
└── index.ts        （改）UsageService：文件读取、mtime 缓存、对外四个方法（usageOf / contextUsageOf /
                        summary / forget），不再自己解析条目
```

`harness/features/telemetry` 留在原处（它是写入方），但它导出的 `StepRecord` 类型被 `parse.ts` 复用——
两者共用一份形状定义，避免解析侧再抄一遍字段。

## 五、步级聚合的前提：`ucode.step` 补三个字段 + 修正一个口径

`StepRecord`（`harness/features/telemetry/index.ts:29-65`）现在的字段够算耗时与占比，但要出「每轮步数」与
「按模型分桶」还缺三样，另有一处口径自相矛盾：

### 5.1 补 `userTurn`（用户轮序号）

`turn`（`:31`）是「本次装配内第几次模型往返」，会话被回收重装后从 1 重来（`pool.ts:881` 的 `detach`），
不能当轮边界用。补一个由池驱动的用户轮计数：新增 `beginUserTurn()`，在
`pool.startRun` / `startInjectedRun` 里调用——与既有的 `beginUserWait` / `endUserWait`
（`telemetry/index.ts:167` / `:174`，由 `pool.ts:138` / `:143` 在交互帧上驱动）完全同一范式。

不靠「按文件顺序找上一条用户消息」去推：步级记录里没有 `entryId`，那种 join 会在压缩、分叉、
`custom_message` 注入这几处全都不可靠。

### 5.2 补 `provider` / `model`

`message_end`（`:219`）本来就在读那条 assistant 消息的 `usage`，顺手取 `provider` / `model` 即可。
没有它，「哪个模型首 token 慢」「哪个模型的缓存命中率高」只能靠文件顺序 join。

### 5.3 补 `stopReason`

失败 / 中断轮的 `firstEventAt` / `firstTokenAt` / `respondedAt` 全是 `null`，现在从记录里分不清
「用户中断」「上游报错」「刚发出去就结束」。取同一条 assistant 消息的 `stopReason` 落进记录。

### 5.4 修正 `ttftMs` 口径

字段注释（`:41`）与 `docs/session-entries.md:95` 都写「响应头 → 首个内容帧」，而 `flush` 实际算的是
`firstTokenAt - startedAt`（`:249`），即含排队与上传的累计值。两者不能同时成立。**以文档为准改代码**：
`ttftMs = firstTokenAt - firstEventAt`。

这样四段（`firstEventMs + ttftMs + streamMs + toolMs`）之和才等于 `endedAt - startedAt`，
分段统计才有意义；「请求发出 → 首帧」的累计延迟在聚合时由 `firstEventMs + ttftMs` 得到，不需要新字段。
另一处口径要在方案里定死：**`toolMs` 含 `userWaitMs`**（`:254` 用 `endedAt - respondedAt`），
所以「纯工具耗时」= `toolMs - userWaitMs`，聚合里必须显式扣，否则等用户的时间会被算成工具时间。

字段语义变了要记 `CHANGELOG.md`；按项目约定不回填历史数据。

## 六、改动清单

| 顺序 | 文件 | 改动 |
| --- | --- | --- |
| 1 | `packages/contracts/src/stats/context.ts`（新） | `ContextUsage` 迁入 |
| 2 | `packages/contracts/src/stats/output.ts` | 删 `ContextUsage`；加步级聚合类型（`StepUsageTotals` / `StepUsageBucket` / `StatsStepSummary`）；`StatsSummaryResponse` 加 `steps` |
| 3 | `packages/contracts/src/sessions/output.ts` | `ContextUsage` 的引用改到新位置 |
| 4 | `server/src/harness/features/telemetry/index.ts` | `StepRecord` 加 `userTurn` / `provider` / `model` / `stopReason`；`ttftMs` 口径；新增 `beginUserTurn()` |
| 5 | `server/src/core/pool.ts` | `startRun`（:295-313）/ `startInjectedRun`（:315-341）调 `telemetry.beginUserTurn()` |
| 6 | `server/src/harness/features/usage/parse.ts`（新） | 从 `index.ts` 抽出条目解析；新增 `ucode.step` 的解析（非法形状跳过，不让一条坏记录打断整份统计） |
| 7 | `server/src/harness/features/usage/context.ts`（新） | 抽出现有的瞬时状态与 `contextUsageOf` / `forget` 的那部分 |
| 8 | `server/src/harness/features/usage/aggregate.ts` | 新增步级派生（见第 5 节的字段）与分位计算 |
| 9 | `server/src/harness/features/usage/index.ts` | `UsageService` 收窄；`CachedSessionUsage` 扩 `steps` |
| 10 | `packages/ui/src/lib/usage-series.ts` | `cacheHitRate` 等纯函数（第七节） |
| 11 | `packages/ui/src/business/usage/*` | 新增步级卡片；命中率进总览卡片、按模型、按日趋势 |
| 12 | `packages/i18n/src/locales/ui/en.ts` | 新文案（步级卡片标题与指标名、命中率） |
| 13 | `server/src/harness/features/usage/__tests__/` | 见第八节 |
| 14 | `docs/session-entries.md` | `ucode.step` 行的 payload 说明更新（三个新字段 + `ttftMs` 口径） |
| 15 | `docs/api-reference.md` | `pnpm api:docs` 重新生成（`StatsSummaryResponse` 多了字段） |
| 16 | `CHANGELOG.md` | 「新增」（步级统计与缓存命中率）+「变更」（`ucode.step` 的 `ttftMs` 字段语义） |

## 七、缓存命中率

数据层早就具备：`UsageTotals`（`packages/contracts/src/stats/output.ts:9-15`）带 `cacheReadTokens` /
`cacheWriteTokens`，解析在 `harness/features/usage/index.ts:52-59`，累加在 `aggregate.ts:28-34`，
所以 `total` / `byModel` / `bySession` / `daily` / `weekly` 全都已经带着它们——缺的只是派生与展示。

- **口径**：`cacheHitRate = cacheReadTokens / (inputTokens + cacheReadTokens)`。
  依据是项目里的既定口径——`calculateContextTokens(usage)`（`harness/features/usage/index.ts:100`，来自 pi）
  把 `input + cacheRead` 当输入侧规模；telemetry 的 `contextTokens` 同口径
  （`telemetry/index.ts:58` 注释与 `:272` 的计算）。即 `input` 是**未命中缓存**那部分。
- **`cacheWriteTokens` 不进分母**：那是写入成本侧，单独作为「缓存写入」呈现。
- **分母为 0 时不给比率**：渲染 `—`，不显示 `0%`（「没有输入」与「全没命中」是两回事）。
- **不加契约字段**：派生量放 `packages/ui/src/lib/usage-series.ts`，配纯函数单测。
- **展示四处**：总览卡片（累计命中率）、按模型（`usage-breakdown.tsx` 的模型行——不同 provider 的
  缓存行为差异是这里最有信息量的对比）、按日趋势（`usage-trend-chart.tsx` 加一条命中率线或模式切换）、
  步级分桶（按 `thinkingLevel` / model 看命中率）。
- **不做成本换算**：沿用「只用 token、不计成本」，不给「省了多少钱」。
- **动工前实测一次非 Anthropic 系模型的 `usage`**：若适配层没把 OpenAI 系的
  `prompt_tokens_details.cached_tokens` 从 `prompt_tokens` 里摊开，`inputTokens` 已含
  `cacheReadTokens`，命中率会算出 > 100%。届时在解析层归一（`inputTokens -= cacheReadTokens`）
  并记 `CHANGELOG.md`——项目不做历史兼容，直接改口径。

## 八、测试

`server/src/harness/features/usage/__tests__/`（沿用现有的合成条目夹具与临时目录会话文件两种写法）：

- `parse`：`ucode.step` 正常解析；字段缺失 / 类型不对的记录被跳过且不影响其余记录；
  `stopReason` 为错误时四个时间字段允许为 `null`。
- 步级聚合：每轮步数按 `userTurn` 分组（两轮各 3 步 → 分布 `3, 3`）；平均与分位耗时；
  四段占比之和为 1（含 `userWaitMs` 的那一例要能验证「纯工具耗时 = `toolMs - userWaitMs`」）；
  按 model / `thinkingLevel` 分桶。
- `cacheHitRate`：分母 0 返回 `undefined`；命中 0 返回 0；全命中返回 1；小数取舍（展示层定）。
- telemetry：`beginUserTurn` 的计数（照 `telemetry/__tests__/telemetry.test.ts` 的假时钟 +
  `SessionManager.inMemory` 范式）；`ttftMs` 新口径的断言要改（现有用例按旧口径写的）。
- `packages/ui/src/lib/__tests__/usage-series.test.ts`：命中率序列与展示格式。

## 九、文档与变更日志

- `docs/session-entries.md`：`ucode.step` 行的 payload 列出新增字段，并写明 `ttftMs` 是
  「响应头 → 首帧」、`toolMs` 含等用户时间。`pnpm verify` 的 `session-entries` 只校验条目名的双向存在，
  字段说明靠人守。
- `docs/api-reference.md`：`pnpm api:docs` 重新生成。
- `CHANGELOG.md`：「新增」记步级统计与缓存命中率；「变更」记 `ucode.step` 的 `ttftMs` 语义修正
  （对外接口加字段也算流程状态变化）。
- `plans/stage-10-usage-stats.md` 是历史记录，不回改。

## 十、验收

- `pnpm check` 一轮一次（biome + 各包 typecheck + 单测 + `pnpm verify`）。
- 真机：跑两三轮带工具调用的对话，扫 `$APP_HOME/harness/sessions/<id>.jsonl` 的 `ucode.step`——
  三个新字段有值、`provider` / `model` 与那条 assistant 消息一致、`userTurn` 在同一轮内不变、
  第二轮起递增；四段耗时与总耗时对得上（不再出现「四段之和小于总耗时」）。
- 浏览器走查：用量面板的步级卡片与命中率四个展示点；`pnpm dev` 开 `:5173`，一串动作合成一次调用。

## 十一、暂不做 / 已否决

- **成本换算**（token × 单价）：不做，沿用既有取舍。
- **单次工具耗时**：不做。现在只有整步 `toolMs` 与工具名清单，按工具拆耗时要在工具调用层逐次计时。
- **首帧 kind**（首个内容是思考还是回答）：不做，需要新增字段，且现有 `firstTokenAt` 只记「任意内容帧」。
- **压缩调用的步级耗时**：不做。压缩只落 `usage` / `compaction` 条目，没有 step 记录。
- **会话内时间序列**：`bySession` 仍是累计总量，不做每会话的趋势线。
- **`ucode.step` 里加 mode / 权限档位**：已否决（见 [`session-params-entries.md`](./session-params-entries.md)
  第六节），按轮记在 `ucode.mode` 上即可。
- **给步级数据开实时 SSE 通道**：不做，聚合走 HTTP 接口，刷新即得。
- **把 `ucode.step` 下发给客户端**：不做，面板展示的是聚合结果。
