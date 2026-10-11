# 模型请求重试：上限 5 次，过程落成 ucode.retry 条目

> 依赖：`docs/session-entries.md`（`custom` 条目的登记与校验）、
> [`skill-usage-record.md`](./skill-usage-record.md)（同一族的观测条目 + 细线的落地范式）。
>
> 状态：**未开始**（方案定稿，待实施）。

## 一、背景与目标

现象：模型请求失败后「没有重试」，用户要求最多重试 5 次，且重试过程要在对话里显示出来。

调研后的事实与现象不一致——**重试本来就开着，只是完全不可见**：

- pi 的回合级重试默认启用：`maxRetries = 3`、`baseDelayMs = 2000`、`maxAgentDelayMs = 60000`
  （`pi-coding-agent/dist/core/settings-manager.js:648-665` + `pi-ai/dist/utils/retry.js:88-89`）；
- 触发链：`agent-session.js:1390`（`_handlePostAgentRun` → `_isRetryableError` → `_prepareRetry`），
  重试主体 `:2990`；可重试判定在 `pi-ai/dist/utils/retry.js:23-86`（`overloaded` / `rate.?limit` /
  `429` / 5xx / `fetch failed` / `socket hang up` / `timed out` / `stream ended before message_stop` …），
  不可重试黑名单在 `:4-22`（quota / billing / subscription limit）；
- 事件齐备：`auto_retry_start`（`attempt` / `maxAttempts` / `delayMs` / `errorMessage`）与
  `auto_retry_end`（`success` / `attempt` / `finalError`）；
- ucode 把这两个事件**丢弃**了（`server/src/core/events.ts:184-185` 的 default 分支），
  且 `applyOverrides`（`harness/setup/session-config.ts:263-274`）只覆盖 `defaultTools` 与 `compaction`，
  没碰 `retry`；
- 失败耗尽也是静默的：模型失败不会让 `prompt()` reject（pi 把它变成 `stopReason: "error"` 的 assistant
  消息），所以 `reportRunError` 不发错误帧；`messageToDTO`（`serialize.ts:188-206`）也只映射
  `content` / `model` / `provider`，不带 `stopReason` / `errorMessage`。

于是用户看到的是「输出停住 → 什么都不发生」。

**目标**：把回合级重试上限改成 5，并把「失败 → 等待 → 重试」做成会话文件里的 `ucode.retry` 条目，
下发展示为细线。

## 二、范围界定

| 场景 | 现状 | 本次 |
| --- | --- | --- |
| 同一轮内模型请求失败（含流中途断开） | pi 自动重试 3 次，界面无感 | 上限改 5，每次重试记一条并下发 |
| 重试成功 | 无痕 | 只落文件，**不下发**（紧接着就是正常输出，界面多一行是噪音） |
| 重试耗尽（最终失败） | 静默收尾 | `end(success: false)` 下发细线，正文给最终错误 |
| provider 层重试（还没拿到响应头就失败） | `retry.provider.maxRetries = 0` | **不动**（决策 1） |
| 用户手动重发 / 编辑重发 / steer | 新的一轮或排队，清掉上一轮的出错标记 | 不变（不是重试语义） |
| 失败终态的 DTO（`stopReason` / `errorMessage`） | 不映射，消息上看不出失败 | 本轮不做（`auto_retry_end.finalError` 已覆盖这条信息） |
| 历史会话 | 没有记录 | 不回填（没有条目就是没有记录） |

## 三、已锁定的决策

1. **5 次改在回合级**：覆盖「流式中途断开」——这是用户实际遇到的场景。provider 层的
   `retry.provider.maxRetries` 保持 0（它只覆盖「还没拿到响应头」，且总延迟会成倍放大）。
2. **展示形态是 `ucode.retry` 条目 + 细线**，不是临时 SSE 帧：可回溯、刷新不丢、多窗口一致，
   与 `ucode.mode` / `ucode.permission_decision` 同一族做法。
3. **只下发两种**：`event: "start"`（第 N 次、等多久、为什么）与 `event: "end"` 且 `success === false`
   （最终失败）。`end(success: true)` 落文件但不下发。
4. **`errorMessage` 按外部不可信内容处理**：它来自上游响应体。细线里只做纯文本展示、按长度截断、
   不渲染任何标记；与 `<fetched>` / `<search_results>` 是同一层对待。
5. **不改 pi 的重试判定与退避算法**：只改上限。哪些错可重试由上游决定，我们不另立一套分类。
6. **不新增设置项**：上限是常量（5），设置页不提供入口；要调就改代码。
7. **写失败只记日志**：与 `recordPermissionDecision`（`pool.ts:807`）、`StepTelemetry.flush` 同一姿态。

## 四、pi 侧接缝与必须处理的坑

**接缝**

- 手动配 `retry` 的入口就是 `settingsManager.applyOverrides`（`session-config.ts:263-274`），
  pi 侧读的是 `SettingsManager.getRetrySettings()`（`settings-manager.js:659`）与
  `getProviderRetrySettings()`（`:688`）。
- 事件走会话池已有的订阅（`pool.ts:687` 的 `session.subscribe`），不必挂扩展。

**坑**

- **配置的确切形状要先核对**：`retry` 的 overrides 字段是平铺（`retry: { maxRetries }`）还是带分组
  （`retry: { agent: { maxRetries } }`）——动工前先读 `settings-manager` 的类型定义，别照猜写。
- **重试期间的在途消息**：pi 在重试前会 append 一条 `context_edit` 把失败尝试从模型投影里抹掉
  （`agent-session.js:829`），所以按 `messages/list` 走的前端不会看到两条 assistant；
  但流式进行中的临时消息仍按既有 `message_end` 收敛，**不新增前端处理**。
- **`agent_end` 上还有个 `willRetry`**（`agent-session.js:736` 补、`:783` 判定）：本轮是否会重试。
  `auto_retry_start` 已经表达了这件事，不用它，避免两处口径。
- **首次尝试失败本身没有事件**：`auto_retry_start` 记的是「即将重试」——`attempt` 从 1 起算的是
  重试次数而不是失败次数。文案要按「第 N/5 次重试」写，别写成「第 N 次尝试」。
- **不可重试的错误不会产生任何条目**：命中黑名单时 pi 直接收尾，界面仍只有那条静默的失败消息。
  这是本轮已知的留白，记在第八节。

## 五、改动清单

| 顺序 | 文件 | 改动 |
| --- | --- | --- |
| 1 | `packages/contracts/src/constants.ts` | 加 `RETRY_RECORD_CUSTOM_TYPE = "ucode.retry"`、`RETRY_RECORD_EVENTS = ["start", "end"]` 与 `RetryRecord`（`event` / `attempt` / `maxAttempts` / `delayMs?` / `errorMessage?` / `success?` / `at`） |
| 2 | `packages/contracts/src/messages/output.ts` | `MessageDTO` 加 `retryRecord?: RetryRecord`（紧挨 `skillRecord` / `modeChange`） |
| 3 | `server/src/harness/setup/session-config.ts` | `applyOverrides` 加 `retry`（上限 5） |
| 4 | `server/src/core/pool.ts` | `session.subscribe` 加 `auto_retry_start` / `auto_retry_end` 分支 → 新增私有 `recordRetry`（`appendCustomEntry` → `transcript_reset`，照 :807 的 `recordPermissionDecision`） |
| 5 | `server/src/harness/pi/serialize.ts` | 加 `retryRecordOf(data)` 逐字段校验；`custom` 分支按决策 3 放行 |
| 6 | `packages/ui/src/lib/chat-nodes.ts` | 新增节点 `kind: "retry"`；条目放行但**不能落进 `content` 兜底行** |
| 7 | `packages/ui/src/lib/chat-rows.ts` | 新增行类型 `ChatRetryRow` |
| 8 | `packages/ui/src/business/message-row.tsx` | 分发到新组件 |
| 9 | `packages/ui/src/business/retry-line.tsx`（新） | 细线组件：形态与 `divider-line.tsx` 同族，文案见下 |
| 10 | `packages/i18n/src/locales/ui/en.ts` | 新文案两条 |
| 11 | `docs/session-entries.md` | 登记 `ucode.retry`（`custom`、不进模型上下文、下发展示为细线） |
| 12 | `docs/api-reference.md` | `pnpm api:docs` |
| 13 | `CHANGELOG.md` | 「新增」（重试上限 5 与过程记录）；`pnpm verify` 会核对条目常量与文档 |
| 14 | `server/src/{core,harness}/__tests__/` | 见第六节 |

细线文案（`i18n` key 即中文文案）：

- `start` → `模型请求失败，{{delay}}s 后重试（第 {{attempt}}/{{maxAttempts}} 次）`，`title` 给截断后的错误文本；
- `end(success: false)` → `重试 {{attempt}} 次仍失败：{{error}}`。

## 六、测试

- `server/src/core/__tests__/serialize.test.ts`：`start` 条目投影出 `retryRecord`；`end(success: true)`
  返回 `null`；`end(success: false)` 放行；`data` 缺字段 / `event` 非法 / `attempt` 非数字时返回 `null`。
- `packages/ui/src/lib/__tests__/chat-nodes.test.ts`：`ucode.retry` 条目生成 `kind: "retry"` 节点、
  不落进 `content` 兜底；`start` 与 `end(false)` 各成一行；`end(true)`（若直接构造数据）不生成行。
- 会话池侧的重试观察：现有核心测试没有覆盖 `session.subscribe` 的分支，本方案不新引组件级夹具——
  用假事件对象直接调 `recordRetry` 的等价路径（把「事件 → 条目」的映射抽成一个可测纯函数，
  照 `matchSkillHit` 那样的做法）。

## 七、验收

- `pnpm check` 一轮一次（含 `session-entries` / `api-docs` 两处校验）。
- 单测覆盖契约投影与行生成；真实失败不易造，界面走查用构造好的会话文件（手工往一份会话 JSONL 里
  追加两条 `ucode.retry` 条目，重启服务后打开）确认：
  1. 细线出现且文案是「…后重试（第 1/5 次）」；
  2. 最终失败那条的文案带错误文本、被截断、不渲染标记；
  3. 刷新后仍在（走快照投影，不是前端内存态）；
  4. 该行不参与轮页脚（不是 assistant 轮的附属）。
- 扫会话 JSONL：`ucode.retry` 条目带 `event` / `attempt` / `maxAttempts`，`start` 另带 `delayMs` /
  `errorMessage`，`end` 带 `success`。
- 配置核对：起一个会话，确认 pi 实际读到的 `maxRetries` 是 5（打一条 debug 日志或读 pi 的设置回显）。

## 八、暂不做 / 已否决

- **provider 层重试也打开**：不做（决策 1）。它只覆盖「还没拿到响应头」的失败，且与回合级叠加会让
  最坏等待时间成倍增长。
- **把重试上限做成设置项**：不做（决策 6）。
- **失败终态的 DTO 字段**（映射 `stopReason` / `errorMessage` 到消息）：本轮不做。`auto_retry_end` 的
  `finalError` 已经给出最终原因；若要覆盖「不可重试直接失败」那条留白，需要另立一条「失败」条目，
  属另一件事，先看这次落地后的实际观感。
- **给「不可重试的错误」也记一条**：同上，与上一项一起评估。
- **实时 SSE 帧形式的临时提示**：不做（决策 2），刷新即失的东西不值一条独立通道。
- **在细线里渲染 markdown / 代码块**：不做。`errorMessage` 是外部内容，纯文本 + 截断即可。
- **重试次数写进 `ucode.step`**：不做。两件事的粒度不同（step 是一步，retry 是这一步里的一次失败尝试）。
