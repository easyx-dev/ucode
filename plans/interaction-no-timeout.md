# 交互中转：去掉权限审批与 question 的等待时限

> 依赖：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 5（交互中转 `core/interactions`、
> 权限审批扩展、`question` 工具）。
> 参考：opencode v2 的权限与提问（`packages/opencode/src/permission/index.ts`、`question/index.ts`）——
> 两者都是裸的 `Deferred.await`，没有任何等待时限，只靠「用户答复 / 会话中断 / 实例销毁」结算；
> 文档里也把无人值守客户端的处理明确甩给客户端（"Non-interactive clients must decide how to handle
> approval requests"）。
> 状态：**已完成**：两个等待时限已删，审批接上了工具调用的中断信号 `ctx.signal`（经 `PermissionAsk.signal` 透传，
> 与方案原稿的形参形状不同，原因见文末）。

## 一、背景与目标

「等服务端提问、等用户答复」这件事上，服务端不该替用户做决定。现在的两处时限会在用户离开一会儿后
把请求自动结算掉（审批按拒绝、提问按失败），用户回来时只能看到一个已经作废的对话框。

**目标**：权限审批与 `question` 都不设时限，一直等答复；「本轮中断」与「会话归档 / 回收」照旧立即结算，
工具调用不会悬空。

**做**：

- 删掉 `PERMISSION_APPROVAL_TIMEOUT_MS` / `QUESTION_TIMEOUT_MS` 两个常量与 `InteractionBroker` 里的 timer。
- 审批补上「本轮中断信号」这条取消通道（现在只有 timer 兜底，见第四节）。
- 同步单测、`docs/` 与 `CHANGELOG.md` 的 `[未发布]` 条目。

**明确不做**：

- 不改动 `present_plan` / 计划决策表单 / 前端对话框（它们本来就无超时，见第二节）。
- 不新增错误码、事件、契约字段或 DB 列；不改 `interactions/list` / `interactions/respond` 的形状。
- 不给其它超时（webfetch / websearch / shell / 子智能体 / 记忆回顾 / 目标校验）做任何调整。

## 二、范围界定

| 交互 | 现状 | 本次 |
| --- | --- | --- |
| 权限审批 `ask` | `PERMISSION_APPROVAL_TIMEOUT_MS`（5 分钟）→ 按 `deny` 结算 | 删时限，改由中断 / 归档结算 |
| `question` 工具 | `QUESTION_TIMEOUT_MS`（10 分钟）→ `{ kind: "timeout" }` → 工具抛「提问超时」可读错误 | 删时限，只保留答复 / 取消两条路 |
| 计划决策表单 | `present_plan` 是纯信号工具，`execute()` 立即返回；表单是前端本地状态，靠下一条消息答复 | 不动 |
| 普通弹窗（重命名 / 设置 / MCP 表单等） | 无 timer（仓库里唯一的倒计时是设置页的配对链接，与交互无关） | 不动 |

## 三、已锁定的决策

1. **两类请求都不设时限**：无人答复就一直挂起。结算只有三条路径——用户答复、本轮中断（`stop` / 子会话被中止）、
   会话归档或回收（`forget` / `forgetSource`）。
2. **审批绑定本轮中断信号**（`ctx.signal`），与 `question` 对称。这是删 timer 的**前置条件**，不是可选优化。
3. **`QuestionAnswerResult` 收敛为 `answered` / `cancelled`**；`FailureReason` 与 `Pending.timer` 删除，
   `Pending.fail` 变成无参的失败结算（审批 → `deny`，提问 → `cancelled`）。
4. **构造与调用形状**：`InteractionBroker(events)`；`requestPermission(sessionId, ask, signal?, source?)`、
   `requestQuestion(sessionId, questions, signal?, source?)`（signal 在 source 之前，两处一致）。
5. **失败姿态沿用既有语义**：中断 / 归档时审批 `deny`、提问 `cancelled`（模型拿到「提问已取消」的可读错误）。
   不新增错误码与事件，`interaction_resolved` 的载荷不变。
6. **客户端重连补齐机制不变**：请求只在进程内存，刷新 / 重连仍由 `interactions/list` 补齐对话框。

## 四、pi 侧接缝与必须处理的坑

`tool_call` 处理器的第二个参数是 `ExtensionContext`，带 `signal: AbortSignal | undefined`
（`dist/core/extensions/types.d.ts:239-240`「The current abort signal, or undefined when the agent is not streaming」）。
它就是本轮 run 的 signal：

- `createContext` 的 `get signal()` → `runner.getSignalFn()`（`dist/core/extensions/runner.js:664-667`）；
- `getSignalFn = contextActions.getSignal`（`runner.js:231`）；
- 实现在 `dist/core/agent-session.js:2720`：`getSignal: () => this.agent.signal`；
- 即 `activeRun.abortController.signal`（pi-agent-core `dist/agent.js:214-220`），`session.abort()` 正是 abort 它。

**坑**：`beforeToolCall` 的 `await` 不与 run signal 竞速——pi-agent-core `dist/agent-loop.js:493-500` 先
`await config.beforeToolCall(...)`，返回之后才检查 `if (signal?.aborted)`；而 `agent-session.js:1873` 的
`abort()` 之后要 `await this.waitForIdle()`。所以一个永久 pending 的审批会让
`POST /api/v1/messages/interrupt`（`server/src/routes/messages/index.ts:82` → `pool.abort`）永久挂起。
`question` 之所以没这个问题，是因为它的 `ask(ask, signal)` 早就把 signal 接到了交互中转上；
审批目前**没有**这条通道，只有 timer 兜底——所以「删 timer」必须与「接 signal」同一次做完。

附带收益：子智能体超时 / 被中止时 `child.abort()`（`harness/features/subagents/spawn.ts:108`）也会立刻结算它挂起的审批，
不再是「等 `settleInteractions` 收尾」。

## 五、改动清单

### 1. `server/src/constants/`

删 `PERMISSION_APPROVAL_TIMEOUT_MS`（:61-62）与 `QUESTION_TIMEOUT_MS`（:64-65）及注释。

### 2. `server/src/core/interactions.ts`

- 文件头注释（:7-8）改为「待答请求只在进程内存；本轮中断 / 会话删除按各 kind 的失败姿态结算
  （审批 `deny`、提问 `cancelled`），工具调用不会悬空」。
- `QuestionAnswerResult`（:25-29）去掉 `{ kind: "timeout" }`；删 `FailureReason`（:31）。
- `Pending`（:39-46）去掉 `timer`，`fail` 改为 `() => void`（注释同步为「无人答复时的结算：审批一律拒绝，提问按取消」）。
- 构造函数（:51-55）只留 `events`，删掉两个 timeout 参数与 :21 的 constants import。
- 新增私有方法：

```ts
/** 本轮中断即按失败结算挂起请求；返回解除监听的函数 */
private settleOnAbort(requestId: string, signal?: AbortSignal): () => void {
  if (!signal) return () => {};
  const onAbort = (): void => {
    this.settle(requestId, (entry) => entry.fail());
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
```

- `requestPermission(sessionId, ask, signal?, source?)`：`signal?.aborted` 时直接 `Promise.resolve("deny")`；
  用 `settleOnAbort` 替换 timer；`respond` / `fail` 各自先 `detach()` 再 resolve（失败姿态 `"deny"`）。
  注释改为「返回用户答复（本轮中断 / 会话清理为 `deny`）」。
- `requestQuestion`：删 timer 与 timer 内的 timeout 分支，改走 `settleOnAbort`；`fail` 固定 `{ kind: "cancelled" }`；
  `signal?.aborted` 早返回保留。
- `settle()`（:184-190）去掉 `clearTimeout(entry.timer)`。

### 3. `server/src/harness/setup/permissions/extension.ts`

- `PermissionGate.request`（:35-36）与 `PermissionHooks.request`（:45-46）加 `signal?: AbortSignal`，
  注释「超时 / 断连按 `deny`」→「本轮中断 / 会话清理按 `deny`」。
- 处理器签名（:58）改 `pi.on("tool_call", async (event, ctx) => …)`，调用（:84-90）改
  `gate.request({ … }, ctx.signal)`。

### 4. `server/src/core/pool.ts`

:364-369 的审批钩子改为 `request: (ask, signal) =>
this.permissions.interactions.requestPermission(interactionSessionId, ask, signal, source)`。

### 5. `server/src/harness/setup/tools/question.ts`

- 文件头注释（:5）改「答复与取消都以可读结果回给模型」。
- 删 `execute` 里的 `result.kind === "timeout"` 分支（:69-73）；`cancelled` 的可读错误保留。

### 6. `server/src/harness/features/subagents/spawn.ts`

:230 注释「避免它超时前一直挂在前端」→「避免子会话已结束而请求仍挂在前端」。

## 六、测试

- `server/src/core/__tests__/interactions.test.ts`：头注释去掉「超时」；8 处 `new InteractionBroker(bus, …)`
  收敛为 `new InteractionBroker(bus)`；删「超时按拒绝结算」「超时结算为 timeout」两条；
  新增「本轮中断时挂起的审批按拒绝结算」（`AbortController` → `"deny"`）与「信号已中断时不挂起请求」
  （`list` 为空）；`forgetSource` 用例的调用改为 `requestPermission("p1", ask, undefined, { source })`。
- `server/src/harness/setup/permissions/__tests__/extension.test.ts`：`Handler` 增加 `ctx: ExtensionContext` 形参，
  加 `call(handler, event, signal?)` 小助手替换现有 `handler(callEvent(...))`；新增一条断言
  `gate.request` 收到的 signal 与 `ctx.signal` 是同一实例（防止信号在中间层被丢掉）。
- `server/src/harness/setup/tools/__tests__/question.test.ts`：头注释同步；删「超时抛可读错误」，「取消」保留。
- `harness/__tests__/session-config.test.ts` 与 `harness/features/subagents/__tests__/spawn.test.ts` 的桩函数少参仍兼容，
  不用改。

## 七、文档与变更日志

- `docs/api.md`：:246「答复或超时后下发」→「答复或请求失效后下发」；:251 同类措辞；:252-254 的生命周期
  改写为「两类请求都不设时限，无人答复时一直挂着；本轮中断（stop）按拒绝 / 取消结算，会话归档一并清理」。
- `docs/modes-and-permissions.md:83`：删掉 `PERMISSION_APPROVAL_TIMEOUT_MS`，改为「审批不设时限；
  本轮中断或会话归档按拒绝结算」。
- `docs/api-reference.md:792`：`resolved` 的说明改为「重复回答或请求已失效则为 `false`」。
- `packages/sdk/src/stores/interactions.ts:111`：注释去「超时」。
- `CHANGELOG.md`：权限审批与 question 本身还在 `[未发布]` 里（:286、:290），**就地改写**这两句为
  「不设等待时限，中断 / 会话归档按拒绝（提问按取消）结算」，不另加一条自相矛盾的「移除」。
  `plans/agent-tools-and-modes.md:340` 是阶段记录，保持原样。

## 八、验收

- `pnpm check` 全绿。
- 手工走查（真实浏览器）：起服务 → 触发一次越界审批 → **不答复**，刷新页面后对话框仍在
  （`interactions/list` 补齐）→ 点停止：审批弹窗收起、本轮结束、`POST /messages/interrupt` 正常返回、
  会话回到 idle（不挂死）。
- 子智能体场景：让子会话触发一次审批，父会话中断 → 子会话的那条请求同步结算，前端不留残影。

## 九、暂不做 / 已否决

- **「拒绝一条即连带拒绝同会话其余 pending 审批」**（opencode 有这个行为）：现状是一问一答，
  加连带拒绝会让同一轮里后出现的请求静默消失；要加属于独立改动，本次不做。
- **客户端侧兜底时限**（`interactions/list` 时判 `createdAt` 过期即丢弃）：与「不替用户做决定」相悖，
  不做。
- **把前端对话框改成可关闭并回传「取消」**：现有「拒绝 / 跳过」已覆盖用户意愿，不需要新入口。
