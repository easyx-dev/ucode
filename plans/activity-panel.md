# 会话活动面板：对话区悬浮的子智能体 / 目标 / 后台服务

> 依赖：[`stage-7c-subagents.md`](./stage-7c-subagents.md)（子智能体委派、增量进度与快照收敛）、
> [`stage-11-goal.md`](./stage-11-goal.md)（目标模式与逐轮记录）、
> [`docs/session-entries.md`](../docs/session-entries.md)（条目登记规则）、
> [`docs/design-surfaces.md`](../docs/design-surfaces.md)（界面规格）；
> 浮层取法见 [`DESIGN.md`](../DESIGN.md)「面层」。
>
> 状态：**未开始**（方案定稿，待实施）。

## 一、背景与目标

三块「跑着但不在视野里」的状态：

1. **进行中的子智能体**：数据现成（`SubagentStreams`，按父会话里的 `toolCallId` 索引，
   `packages/sdk/src/types.ts:30-43`），服务端还随 `messages/list` 下发 `SubagentSnapshot[]` 兜底收敛
   （`packages/contracts/src/messages/output.ts:86-93`）。但它只内联在 `subagent` 工具卡里，
   而那张卡默认收起（`tool-call.tsx` 的 `open` 初值 `false`）——不点开就完全看不见。
2. **目标进度**：`GoalBar` 已在输入区上方展示状态与用量，但「第几轮、这一轮花了多少、下一步是什么」
   要展开「目标轮次」才看得到。
3. **bash 工具调起的后台服务**：**服务端没有任何记录**。`harness/shell/` 三层封装只透传
   `BashOperations.exec(command, cwd, options)`，拿不到 pid / 进程组 / 端口；条目、投影与事件流里都没有这类信息。

**目标**：对话区右下角一枚悬浮入口（有活动才出现），把这三块收敛到一张只读面板里——一眼看全，
点进去看细节。

**做**：

- 新增「后台服务」运行态：`bash` 执行层按端口线索 + 前后探活对比判定「这条命令起了哪个服务」，
  走一条全量事件帧 + `messages/list` 快照下发。
- 新增悬浮活动面板（子智能体 / 目标 / 后台服务三段）。
- 子智能体进度从工具卡内联移到面板，工具行留一个指向面板的短入口。

**明确不做**：见第十节。

## 二、范围界定

| 项 | 现状 | 本次 |
| --- | --- | --- |
| 子智能体实时进度 | 内联在工具卡的 `CollapsibleContent` 里，默认收起 | 移入面板；工具行留短入口（带定位） |
| 子会话完整往来 | `openSubagentSessionDialog` 的居中模态小窗（`subagent-session-dialog.tsx:68-71`） | 不动；面板里的项点击走同一个去向 |
| 目标 | `GoalBar` 常驻输入区上方，承担暂停 / 恢复 / 清除 / 预算 | 不动；面板只做只读聚合 |
| 后台服务 | 无数据、无界面 | 新增运行态 + 面板段（只读） |
| 面板范围 | — | 只当前会话（多窗口多会话各自独立） |
| 会话条目（JSONL） | — | 不新增（服务是运行态，见决策 5） |

## 三、已锁定的决策

1. **形态**：右下角悬浮胶囊，**有活动才出现**；点开在对话区右下浮出面板，`max-h` 约六成、内部滚动，
   `z-10`（低于决策面板与所有 Portal 弹层的 `z-50`）。
2. **三段只读**：子智能体可点开子会话小窗，目标是纯聚合，后台服务是纯展示（地址可点可复制）。
3. **`GoalBar` 保留**：主控（暂停 / 恢复 / 清除 / 预算）不搬进面板——面板收起时也要能一眼看到目标在跑。
4. **服务判定 = 端口线索 + 前后探活对比**：只有「命令执行前不可连、执行后能连」的回环端口才算本次命令起的。
   不用 `lsof`、不做全机监听端口 diff（跨平台依赖与误报都更差）。
5. **服务清单是运行态**：随事件帧增量维护 + `messages/list` 快照兜底，与 `pool.subagents` 同口径；
   **不写 JSONL 条目**（生命周期短、不需要回溯）。
6. **不追踪 pid、不提供「停止」**：公开接口拿不到 pid / 进程组，按端口反查再 kill 会误杀别人的进程。
7. **子会话不注入探测钩子**：面板只服务主会话。
8. **面板覆盖「进行中 + 本次会话已结束」**：跑完的子智能体不在进度快照里，但结果留着 `task_id`
   （`packages/ui/src/lib/tool-view.ts:170` 的 `subagentSessionIdOf`），折叠成一组展示，否则「跑完就消失」。

## 四、后台服务：判定与状态

### 4.1 pi 侧能拿到什么

`BashOperations`（`@earendil-works/pi-coding-agent` 的 `dist/core/tools/bash.d.ts:35-52`）只透传：

```ts
exec: (command: string, cwd: string, options: {
  onData: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}) => Promise<{ exitCode: number | null }>;
```

pid 只在 pi 内部用于 `killProcessTree`，`trackDetachedChildPid` 也未从包主入口导出。所以「哪个进程是这次命令起的」
不能从进程关系上归因，只能从**可观测的外部效果**归因——端口是最稳的那个。

### 4.2 算法

```
exec 前：portsFromCommand(command) → 并发发起 pre-probe（不 await）
exec 中：旁路拼一份输出（截断上限）
exec 后：fire-and-forget 结算
         ① 线索 = portsFromCommand(command) ∪ portsFromOutput(output)
         ② 只探回环：localhost / 127.0.0.1 / 0.0.0.0 / ::1 / :: 归一化后连 127.0.0.1
         ③ 命中条件：pre = 不可连 ∧ post = 可连
         ④ 命中 → 记录并 emit 一帧
```

- **只连回环**：域名与公网 IP 一律丢弃（`isLoopbackHost`），探测不产生任何对外连接——守住
  「服务默认只监听回环、不要把服务暴露到不可信网络」的既有边界。
- **结算绝不阻塞 `exec` 返回**：否则拖慢工具结果入上下文。
- **线索来源**：命令里的 `http://host:port` / `host:port` / `--port N` / `PORT=N` / `port N`；
  输出里同样的 URL 与端口形态（识别 `Local:` / `Listening on` 之外的裸 `host:port` 就够了，不做过宽的猜测）。
- **pre-probe 的竞速**：命令可能在探测返回前就结束（如 `echo`），所以 pre-probe 的 Promise 由结算端 await
  （带超时上限），而不是「命令结束后才开始探」。

### 4.3 包裹位置与异常路径

插在 `createLocalBashOperations()` 之外、`withShellGuard` 之内（`harness/shell/index.ts:19-37` 的流水线）：

- `withBlockedCommands` 是最外层且命中即 `return`（`blocked.ts:43-53`），**被拦下的命令根本进不来**，
  不会为一条没跑的命令探测；
- 看门狗的超时与用户中断是 `throw`（`guard.ts:88-101`），`finally` 里照常结算——正好覆盖
  「命令被中止但服务已 detach 存活」这一情况；
- sessionId 由装配层注入（`createShellExtension(deps)`），与 `subagents` / `goal` / `question` 同一条路：
  `pool.ts:669-671` → `SessionAssemblyInput` → `session-config.ts:197`。

### 4.4 状态刷新

不引定时器，三个时机：

1. 每次 bash 命令结算时，顺带重探本会话已知服务（状态从「监听中」变「已停止」通常就在这时被发现）；
2. 每轮 `agent_settled` 时（`pool.ts:801-803` 的主会话分支）；
3. 面板每次打开时客户端调 `client.messages.refresh(sessionId)`（`stores/messages/index.ts:228-230`），
   **复用已有快照接口，不加新 HTTP 接口**。

## 五、数据通道

三块数据里子智能体与目标都已打通，只有服务是新的。服务清单走**一条全量帧**而不是 `start` / `end` 对：
清单小、状态是「监听中 ↔ 已停止」这种非二元变化，全量替换最省心智，快照收敛逻辑退化成一次赋值。

```
server: BackgroundServices.observe/refresh → emitFrame("service_update", 全量数组)
client: engine.applyFrame 直接替换 state.services
快照:   MessageListResponse.services === 同一形状
```

## 六、改动清单

### 6.1 契约

| 文件 | 改动 |
| --- | --- |
| `packages/contracts/src/messages/output.ts` | 新增 `BackgroundService`（`id` / `command` / `cwd` / `port` / `url` / `status` / `startedAt` / `updatedAt`），落在 `SubagentSnapshot`（`:86-93`）之后；`MessageListResponse` 加 `services`（`:104` 旁） |
| `packages/contracts/src/events.ts` | `EVENT_NAMES` 加 `service_update`（`:45-47` 一带），顶部注释写明载荷是**全量** `BackgroundService[]` |
| `packages/contracts/src/constants.ts` | `SERVICE_STATUSES = ["listening", "stopped"] as const`（与 `GoalStatus` 同口径） |

`id` 取端口的十进制字符串：一个端口一个服务，同端口重复起即覆盖（命令与 `startedAt` 换新）。
`url` 由服务端拼（`http://127.0.0.1:<port>`），客户端不拼地址。

### 6.2 服务端

| 文件 | 改动 |
| --- | --- |
| `server/src/constants.ts` | `SERVICE_PROBE_TIMEOUT_MS`（300）、`SERVICE_OUTPUT_CAPTURE_MAX_BYTES`（64 KiB）、`SERVICE_MAX_TRACKED_PER_SESSION`（20，防清单膨胀） |
| `server/src/harness/shell/services.ts`（新） | 纯函数 `portsFromCommand` / `portsFromOutput` / `isLoopbackHost` + `probePort`（`net.createConnection` → `127.0.0.1`）+ `withServiceWatch(base, deps)` |
| `server/src/harness/shell/index.ts` | `createShellExtension(deps?)` 接探测钩子，插进 `:24-29` 的流水线 |
| `server/src/harness/session-config.ts` | `SessionAssemblyInput` 加 `services?: ServiceWatchHooks`（`:94-126`）；`:197` 改 `createShellExtension(input.services)` |
| `server/src/core/background-services.ts`（新） | `BackgroundServices` 类，按 `RunTracker` 先例：持 `SessionEventBus`，`observe(sessionId, { command, cwd, port })` / `refresh(sessionId)` / `listOf(sessionId)` / `forget(sessionId)`，**状态真的变了才 emit** |
| `server/src/core/pool.ts` | 构造时 `new BackgroundServices(this.events)`；`:669-671` 旁注入 hook（子会话不注入）；`:801-803` 的主会话分支调 `refresh`；`dispose`（`:1061` 附近）调 `forget`；加 `listServicesOf(sessionId)` 转发 |
| `server/src/routes/messages/index.ts` | `:59` 旁加 `services: services.pool.listServicesOf(sessionId)` |

`SessionPool` 现约 1145 行，远超 600 行强制拆分线，所以新状态**一律不进 pool 的字段**——
pool 只留「创建 / 注入 / 转发 / 清理」四处接线。

### 6.3 SDK

| 文件 | 改动 |
| --- | --- |
| `packages/sdk/src/stores/messages/engine.ts` | state 加 `services: BackgroundService[]`（`:33-52`）与初值 `[]`（`:72-84`）；`applyFrame`（`:184`）加 `service_update` 分支直接替换 |
| `packages/sdk/src/stores/messages/index.ts` | hydrate 时 `services: snapshot.services`（`:88-127` 那一段） |
| `packages/ui/src/hooks/use-chat.ts` | `ChatController` 加 `services` 与 `refresh()`（转发 `client.messages.refresh`） |

### 6.4 UI

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/lib/activity.ts`（新） | 纯函数：三块数据 → 面板视图模型（胶囊摘要、活跃计数、服务按状态分组、已结束子智能体的提取）。用 `export const` 箭头函数 |
| `packages/ui/src/lib/__tests__/activity.test.ts`（新） | 见第七节 |
| `packages/ui/src/business/activity-panel.tsx`（新） | 面板本体（三段 + 空态 + 关闭），外形抄 `decision-panel.tsx:19-22` 的 `bg-popover` + `ring-1 ring-foreground/10` + `shadow-lg` + `rounded-xl` |
| `packages/ui/src/business/activity-dock.tsx`（新） | 悬浮胶囊 + 展开态 + `focusToolCallId` 定位高亮（`scrollIntoView` + 短暂 ring） |
| `packages/ui/src/business/subagent-entry.tsx`（新） | 工具行上的短入口（`1 个子智能体 · 执行中`） |
| `packages/ui/src/business/message-list.tsx` | `renderExtra`（`:117-129`）换实现：`subagent` 条目返回 `SubagentEntry`，不再渲染内联进度；新增 `onOpenActivity` prop（沿 `onOpenSession` `:58` 同一条链下到工具卡） |
| `packages/ui/src/business/chat-panel.tsx` | `MessageList` 包进 relative 容器并挂 `ActivityDock`（`:317-328`）；传 `chat.subagents` / `chat.services` / `goal` / `goalTurns` / `openSubagent` / `onOpenActivity` |
| `packages/ui/src/business/subagent-progress.tsx` | **删除**（`SubagentProgress` 与 `SubagentSessionLink` 都不再被引用） |

`MessageList` 根节点已经是 `relative`（`message-list.tsx:229`），「回到底部」按钮就是同层
`absolute … z-10`（`:271-279`）——面板按同一位置挂。hero 空态下 `MessageList` 整块不渲染
（`chat-panel.tsx:315`），面板自然也不出现。

### 6.5 i18n 与文档

- 文案全走 `t("中文 key")`：`packages/i18n/src/locales/ui/en.ts` 补英文；`zh-CN.ts` 按 `pnpm verify`
  的实际口径决定是否补同文案（key 即文案）。「执行中」「完成」「失败」「第 {{n}} 轮」
  「{{used}} / {{budget}} token」等 key 已存在，直接复用。
- `docs/api.md`：事件流小节加 `service_update`。
- `docs/api-reference.md`：`pnpm api:docs` 重新生成（逐字节比对，不跑必挂）。
- `docs/design-surfaces.md`：新增一节「活动面板」（悬浮入口、三段内容、层级与开关）。
- `CHANGELOG.md`：加一条；`README` 的事件表本就没列 `subagent_*` / `goal_update`，不追。
- `docs/session-entries.md`：**不动**（不新增条目）。

## 七、测试

`node:test` + `node:assert/strict`，与被测模块同级 `__tests__/`：

- `server/src/harness/shell/__tests__/services.test.ts`：
  - `portsFromCommand` / `portsFromOutput`：URL 形态、`--port` / `PORT=` / `port N`、重复端口去重、
    非回环 host 丢弃、正文里的数字不被误认成端口；
  - 命中判定：pre 可连 → 不算（挡住「探到别人已有的服务」）；pre 不可连 ∧ post 可连 → 算；
    两条都不可连 → 不算；
  - 异常路径也结算：`exec` 抛错（超时 / 中断）时仍发起一次结算。
- `server/src/core/__tests__/background-services.test.ts`：`observe` 合并同端口、`refresh` 状态变化才 emit、
  超过 `SERVICE_MAX_TRACKED_PER_SESSION` 时的收敛、`forget` 清理。
- `packages/ui/src/lib/__tests__/activity.test.ts`：胶囊摘要与活跃计数、服务分组（监听中 / 已停止）、
  已结束子智能体的提取（含没有 `task_id` 的条目被滤掉）。
- `packages/sdk/src/stores/messages/__tests__/engine.test.ts`（新目录）：`service_update` 帧替换 state.services；
  快照 hydrate 后以快照为准。

## 八、验收

- `pnpm check` 一轮一次。
- 真实浏览器走查一次（`pnpm dev` 开 `:5173`，一串动作合成一次调用）：
  1. 让 agent 跑一条 `pnpm dev &` 之类的命令 → 胶囊出现且服务段有该项（地址可点、状态「监听中」）；
  2. 派一个子智能体 → 面板出现该项且在执行中，工具行入口能打开面板并定位到它，点该项能开子会话小窗；
  3. 设一个目标 → 面板目标段的轮次与用量随轮次推进更新，`GoalBar` 仍在输入区上方可用；
  4. 杀掉后台服务、等下一轮落定 → 状态变「已停止」并归入折叠分组；
  5. 面板展开时不挡输入区、不遮住消息区底部的新内容（「回到底部」仍可见可点）；
  6. 空态（还没有任何消息）不出现胶囊。

## 九、已知边界与代价

- **执行中的长驻服务要等命令返回或中止才进面板**：`pnpm dev &` / `nohup … &` 立即返回，覆盖得到；
  直接跑 `pnpm dev` 那种挂住的情形要等看门狗中止它。执行期实时探测需要与 `exec` 生命周期绑定的计时器，
  见第十节。
- **单机、单用户假设**：服务从 127.0.0.1 探活，只对「服务起在本机回环」这一形态有效（局域网访问的
  情形探不到）。
- **命令文本进面板**：命令原文会显示（截断），其中的环境变量值可能含凭证——但它本来就随 `tool_call`
  参数落在会话文件里，不新增泄露面；面板不额外展示环境变量。
- **`SERVICE_MAX_TRACKED_PER_SESSION` 之外的服务会丢**：超限时丢最旧的已停止项，保留监听中的。

## 十、暂不做 / 已否决

- **追踪 pid / 进程组、提供「停止服务」**：公开接口拿不到 pid，按端口反查再 kill 可能误杀别人的进程；
  正是为了避开这点才不引 `lsof`。要做就得自己实现 `BashOperations`（自己 spawn，接管输出流与超时语义），
  风险与工作量是另一个量级。
- **全机监听端口 diff（`lsof -iTCP -sTCP:LISTEN`）**：跨平台依赖且会把「执行前后恰好有别的程序起的服务」
  算进来；端口线索 + 前后对比已经够用。
- **落 `ucode.service` 条目**：运行态不需要回溯，与 `pool.subagents` 同口径不落盘。
- **跨会话聚合**（面板里看所有会话在跑什么）：与「面板只服务当前会话」相悖；多窗口多实例自己看自己的。
- **执行期定时探测**：后续增强，需要与 `exec` 生命周期绑定的计时器与清理。
- **面板里就地展开子会话实时过程**：会与「一览」的定位冲突，交给现成的小窗。
- **把 `GoalBar` 收进面板**：主控不藏一层。
