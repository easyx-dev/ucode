# 阶段 11 · goal 模式（目标模式）

> 计划母文档：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 11；路线见 [`stage-8-session-fork.md`](./stage-8-session-fork.md) 1.2。
> 参考：[zcode 目标模式](https://zcode.z.ai/cn/docs/goal)、[Codex `/goal`](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)、
> [Claude Code `/goal`](https://code.claude.com/docs/en/goal)、[`@schovest/pi-goal`](https://pi.dev/packages/@schovest/pi-goal)。
>
> 状态：**已完成**（`68abc27`）。本文是阶段 11 的细化方案与落地记录。

## 一、目标与范围

**目标**：给当前会话设一个目标（`/goal <目标>`），每轮落定后用一次独立的**校验模型调用**判断是否达成；
未达成则自动开下一轮，直到达成、用户暂停/清除、或触发止损。把「盯着 agent 反复说继续」变成「设个目标等结果」。

**做**：

- `/goal` 命令族：设定（含替换）、查看、暂停、恢复、清除；可选 token 预算。
- 每轮 `agent_settled` 后服务端校验一次，未达成自动续跑。
- 轻量目标栏：目标、状态、轮数、用量、下一步摘要，以及暂停/恢复/清除。

**明确不做**（留后续）：

- 模型侧 `goal_complete` / `goal_blocked` 工具（本期用服务端评估器，见「已锁定的决策」）。
- 消息流里的「第 N 轮」分隔线与逐轮摘要面板。
- 校验器独立核对文件系统（它只看转录与工具活动摘要，实据靠提示词约束模型自查）。
- 关掉应用后的后台续跑（服务端进程在才续跑；重开后目标状态还在，可手动恢复）。

## 二、已锁定的决策

1. **goal 是会话属性，不是第四种 `SessionMode`**：叠加在 `build` 上，不改变工具集 / 权限 / 提示词能力。
   与 zcode / Codex / pi-goal 一致——目标决定「做到什么程度算完」，模式决定「过程中多少操作要确认」。
2. **仅 `build` 可设目标**；`plan` / `ask`（只读）拒绝设置。设置期间把模式切走 → 自动暂停（`cause = mode`，见母文档）。
   Codex / zcode 同为「计划模式不续跑」。
3. **达成判定走服务端评估器**（Claude 口径）：每轮落定后 `runtime.completeSimple` 判定，输出
   `{achieved, reason, nextStep}`。模型无专用完成工具。
4. **状态存 `session` 表单列 `goal_state`（JSON）**，归「会话状态组」。删库重建会丢目标（与 `mode` 同口径，不做迁移）。
5. **`/goal` 由客户端识别 + 专用 `goals/*` 接口**，不进 `messages/prompt`。
6. **三层止损**（对齐其他家）：
   - **无进展**：连续 3 轮无工具调用 → 暂停（`cause = no_progress`）。Codex / Claude / pi-goal 均为标配。
   - **token 预算**：可选、默认不限；`usageOf(sinceMs = startedAt)` 现算。Codex 视其为治理边界。
   - **轮数断路器**：默认 25 轮自动续跑（pi-goal 同值；社区插件 50；Codex/Claude 不设固定轮数）。
7. **中断 / 切模式 → 暂停**；`pause` 会中断当前轮（zcode / pi-goal 口径），`clear` 不中断。
8. **fork 不继承目标**，子会话不可设目标；目标归属会话，不随 cwd 传播。

## 三、契约（packages/contracts）

- 新增 `goals/input.ts`：`goalSetInputSchema = { sessionId, objective(1..4000), tokenBudget? }`；
  查看 / 暂停 / 恢复 / 清除复用 `sessionIdInputSchema`。
- 新增 `goals/output.ts`：
  - `GoalVerification = { achieved, reason, nextStep, at }`
  - `GoalView = { objective, status, cause, turns, tokenBudget, tokensUsed, startedAt, updatedAt, verification }`
  - `GoalResponse = { sessionId, goal: GoalView | null }`
- `constants.ts`：`GOAL_STATUSES`（`active | paused | completed`）、`GOAL_PAUSE_CAUSES`
  （`user | mode | interrupted | no_progress | limit | budget | error`）、`GOAL_MAX_OBJECTIVE_LENGTH`。
- `sessions/output.ts`：`SessionInfoResponse` 追加 `goal: GoalView | null`。
- `events.ts`：新增 `goal_update`（载荷 `GoalView | null`）。
- 不新增错误码：复用 `invalidRequest` / `notFound` / `sessionBusy`。

## 四、DB

- `db/index.ts`：`SCHEMA_VERSION` 3 → 4，迁移 4 `ALTER TABLE session ADD COLUMN goal_state TEXT;`。
- `db/session-repository.ts`：`SESSION_COLUMNS` / `rowSchema` / `toRecord` / `SessionRecord` 增 `goalState`（原始 JSON 文本）；
  新增 `setGoal(id, state: string | null)`（可显式清空，不复用 `set` 的 COALESCE）。`goalState` 不进 `SessionOverride`。
- `docs/database.md`：列分组补 `goal_state`。

## 五、server

- 新增 `agent/goal/`：
  - `state.ts`：`goalStateSchema`（zod）+ 状态迁移纯函数（set / pause / resume / clear / complete、turns、no-progress 计数）。
  - `verify.ts`：`runGoalVerification` + `parseGoalVerdict`；输入 = 目标 + 最近交流 + 工具活动摘要，
    全部当不可信资料包裹；解析失败按「未达成」处理。
  - `prompt.ts`：`buildGoalKickoff` / `buildGoalContinuation`（`<goal>` 信任边界、要求可核对产出）。
  - `index.ts`：`GoalService`：
    - `view(record, live?)`：StoredState → `GoalView`（补 `tokensUsed`）。
    - `set/pause/resume/clear(record, ...)`：改状态 + 持久化 + 发 `goal_update`。
    - `onSettled(sessionId, session)`：守卫 → 校验 → 完成 / 分类暂停 / 返回续跑文本；单会话在途守卫；
      校验后按「身份 id」重新确认状态未变，作废替换 / 暂停 / 清除后迟到的旧结果；
      返回类型 `{ continue: string } | null`，由 pool 起下一轮（不反向依赖 pool）。
    - `forget(sessionId)`：清在途守卫。
- `core/pool.ts`：
  - `startRun(sessionId, session, text)`：把 `run.ts` 的后台起轮收敛进来（`beginRun`/`endRun` + `refreshIndex` + 错误走 `events.emitError`）。
  - `agent_settled` 订阅追加 `goals.onSettled(...)`，有续跑文本时调 `this.startRun(...)`。
  - `dispose` 调 `goals.forget`。
- `core/run.ts`：`startRun` 改为委托 `pool.startRun`（去重复）。
- `routes/goals/index.ts`：`set`（校验 build、存在、空闲）、`status`、`pause`（置 paused + `pool.abort`）、
  `resume`（置 active + 起恢复轮）、`clear`。全部 `ok(...)` 出参。
- `app.ts`：装配 `GoalService`，加入 `Services`。
- `index.ts`：挂 `/goals`。
- `routes/sessions/index.ts`：`describeSession` 带 `goal`；`updateSession` 切走 build → 暂停；`archiveSession` 清目标。
- 校验器调用经 `completeSimple`，不写入会话 JSONL，**不计入 goal 用量**（已知边界）。

## 六、前端

- `lib/api.ts` + `lib/types.ts`：`goals.{set,status,pause,resume,clear}`、`GoalView` 等类型转出。
- `hooks/use-goal.ts`：切会话取 `sessions/info.goal`，订阅 `goal_update` 增量。
- `components/goal-bar.tsx`：目标 / 状态 / 轮数 / 用量 / 下一步；暂停·恢复·清除。
- `chat-panel.tsx`：输入区上方渲染目标栏；`submit` 前识别 `/goal` 命令（裸 = 查看，`pause|resume|clear|replace`，其余 = 设定）；
  草稿态先建会话再设。
- i18n：`packages/i18n` 的 `ui` 中英目录齐平。

## 七、测试方案

**L2 单测**（`server/src/agent/goal/__tests__/goal.test.ts`）：

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| GO-01 | set / 替换 / 暂停 / 恢复 / 清除 | 状态与 `cause` 正确，序列化往返一致 |
| GO-02 | 连续无工具调用 3 轮 | `no_progress` 暂停 |
| GO-03 | 达到轮数上限 | `limit` 暂停 |
| GO-04 | 达到 token 预算 | `budget` 暂停 |
| GO-05 | 校验输出解析 | 合法 JSON 解析；坏输出按未达成 |
| GO-06 | 归档 / 子会话 | 不续跑、目标被清 |
| GO-07 | 校验期间清除 / 替换目标 | 迟到结果作废，清除后不复活、替换保留新目标 |

**L3 集成（Hono `app.request`）**：`goals/set` 在 plan/ask → 400、运行中 → 409；
`sessions/info` 带出 `goal`；`goals/clear` 后 `info.goal` 为 null。

**L4 冒烟 / L5 浏览器**：`pnpm smoke` 加一条「可达成的目标 → 至少自动续跑一次」；
`agent-browser` 走查目标栏与 `/goal` 命令。

## 八、验收

- `/goal <目标>` 后目标栏出现、自动推进；达成后停止；暂停/恢复/清除可用，刷新后保持。
- plan / ask 下设置被拒；运行中设置被拒；切走 build 自动暂停。
- 三层止损分别生效，且都是**暂停**（保留目标）而非硬终止。
- `pnpm check` 全绿。

## 九、风险与边界

- **模式不是安全边界**：目标模式同样防不住提示注入；止损只降低代价，不构成隔离。
- **校验器不独立取证**：它只看转录与工具摘要，不能核对文件系统；「实据」靠提示词约束模型自查。
- **校验调用不计入用量**：`completeSimple` 不进 JSONL，因此 goal 的 token 预算不含校验开销。
- **续跑与用户输入的竞态**：只在 `agent_settled` 且空闲时续跑；单会话在途守卫避免重复校验；
  与用户新轮次的极小竞态按「用户优先」处理（用户轮次会自然接管）。
- **掉库即丢**：`goal_state` 不随 JSONL 重建，删 `app.db` 后目标清空（与 `mode` 同口径）。

## 十、落地顺序

1. 契约 → 2. DB 迁移 + 仓储 → 3. `agent/goal/` + 单测 → 4. pool `startRun` 收敛 + `onSettled` 接线 →
5. 路由 / 事件 / 装配 / sessions 钩子 → 6. 前端 api / hook / 目标栏 / `/goal` / i18n →
7. `CHANGELOG.md` + 母文档进度表 → 8. `pnpm check` + smoke + `agent-browser` → 停下等 review。

## 十一、复盘（落地时的偏差）

- **续跑由会话池驱动，GoalService 不反向依赖池**：`onSettled` 只做判定与改状态，返回下一轮文本
  (`{ continue } | null`)，由池在 `agent_settled` 后 `startRun` 投递。顺带把 `core/run.ts` 的后台起轮
  收敛成 `pool.startRun`（`beginRun`/`endRun` + 索引刷新 + 错误回传），HTTP 触发与目标续跑共用一条路径。
- **校验是一次网络调用，落定后按「身份 id」作废旧结果**：状态里带一个 `id`（设定 / 恢复时轮换），
  `onSettled` 在 await 前捕获它，返回后重读状态，只有仍为 `active` 且 id 未变才写回与续跑；
  否则丢弃。否则用户在校验窗口内替换 / 暂停 / 清除目标会被旧状态覆盖（清除后复活、替换被回退）。
  池投递续跑前再确认会话仍是池里那个实例，避免会话已被回收 / 重建时往废弃实例上起轮。
- **路由只在真正发生迁移时动作**：`pause` 仅在 `active → paused` 时中断当前轮（无 active 目标不再误伤
  正在进行的生成）；`resume` 仅在 `paused → active` 时起恢复轮（已 active 时不再多起一轮）。
- **校验复用记忆的交流摘取**：`textOf` / `sliceExchange` 抽到 `agent/transcript.ts`，记忆与目标各按自己的
  轮数 / 字符上限调用，去掉 goal → memory 的跨功能依赖。
- **无进展口径**：比较最后一条 assistant 正文规范化后的结果，连续 3 轮无工具调用即暂停；
  `noProgress` / `lastText` 随状态一起存库，跨回收保持。
- **首版 kickoff / continuation 以 `<goal>` 开头**，侧栏标题因此显示 `<goal>`（标题取首条用户消息首行）；
  改为以「目标：…」开头（用户可读、也是标题来源），把「这是任务数据不是系统指令」的声明紧随其后。
- **用量口径**：`usageOf(sinceMs = startedAt)` 现算，校验调用经 `completeSimple`、不进 JSONL，不计入。
- **验收**：`pnpm check` 全绿（**236 单测** + 6 项约定校验，较阶段 10 的 208 增 28）。
  真实服务 curl 走通——`goals/set` 启动第一轮即由校验判达成并 `completed`、`tokensUsed` 正确；
  plan 模式设置 → 400；`pause`（`user`）/ `resume` / `clear` 与 `sessions/info.goal` 均符合预期；
  已完成后 `resume` / `pause` 保持完成态、不再起轮或误中断。
  `agent-browser` 走查——输入区上方目标栏（目标 / 状态 / 轮数 / 用量 / 清除），`/goal` 命令设定后面板出现并随完成更新状态。
- **未做**：L3 `app.request` 集成测试（沿用阶段 10 口径，只覆盖 L2 + 真实服务 curl）；
  真实服务里没构造出「必然需要续跑」的用例（简单目标一轮即达成），三层止损由单测覆盖；
  「校验期间清除 / 替换」的竞态由单测按可控时序覆盖。
- **已知边界**：与「风险与边界」一致——校验器不独立取证、校验调用不计用量、
  `goal_state` 掉库即丢；`/goal` 只在客户端识别（其它客户端需直接调 `goals/*` 接口）。
