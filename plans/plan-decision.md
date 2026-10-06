# 计划决策：有条件收尾与「忽略」

> 母文档：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 2.5（plan 重做：`present_plan` + 决策表单）。
> 依赖：[`stage-9-edit-history.md`](./stage-9-edit-history.md) 定下的跨连接同步机制 `transcript_reset`
> （活动分支改变 → 所有在线客户端重取快照）。
> 参考：pi `SessionManager`（1.0.2，`dist/core/session-manager.d.ts` 的 `appendCustomEntry` / `CustomEntry` /
> `buildContextEntries`）；opencode v2（计划模式写文件、持久决策落项目级规则，均不宜照搬，见第十节）。
>
> 状态：**已完成**。评审确认的取舍：**忽略 = 会话文件里追加一条可见的界面标记条目**，
> 不新增 DB 列、不新增事件、不引入旁路状态。

## 一、背景与目标

两个待解问题，都出在「plan 模式收尾」这一环：

1. 一轮 plan 回复在消息区出现**两张 `present_plan` 卡片**：一条是 assistant 消息里的 `toolCall` 区块
   （工具卡片正文是参数 `{}`），另一条是独立的消息条目
   （`role: "tool"`、`toolName: "present_plan"`，卡片正文是工具返回文案）。两者是**两条不同消息**，
   所以各自带自己的时间戳。隐藏这张卡片已记在 `TODO.md`「plan 模式」一节，**本次不做**。
2. **该不该弹决策表单由提示词决定，界面判不了**。前端 `planReady`
   （`packages/ui/src/presets/workspace-layout.tsx` 的「plan 模式本轮以 present_plan 收尾」一处）只做语法判断：
   plan 模式 + 不在生成中 + 本轮出现过 `present_plan`。而
   `server/src/agent/prompt/locales/zh-CN.ts` 的 `modeConstraints.plan` 是**无条件**要求收尾调用的
   （「并在末尾调用 present_plan 收尾」），于是「了解这个项目，看看接下来可以做什么」这类
   **没有可落地方案、需要用户先拍板方向**的轮次也会弹表单。判据只能写进提示词与工具说明，界面只认信号。

**目标**：

- 该不该弹表单由模型按提示词给的判据判断；方案成型才 `present_plan` 收尾。
- 决策表单新增「忽略」：本次计划不再追问；刷新与多窗口一致；忽略后对话里留痕（用户能看到自己做过这个决定）。

**做**：

- `present_plan` 收尾改为有条件，提示词 / 工具说明补「不该调用的情形」。
- 决策表单加「忽略」按钮，服务端权威、跨刷新 / 跨客户端一致。
- 忽略的落点就是 pi 的会话 JSONL：追加一条 `custom` 标记条目，并在对话区显示「已忽略计划」。
- 文档、i18n、评测用例、测试与浏览器走查。

**明确不做**：

- 不隐藏 `present_plan` 卡片（`TODO.md` 保留）；也不隐藏忽略之前那张计划卡片。
- 不给 `present_plan` 加必填参数（`title` / `steps` 一律不加）。
- 不用 localStorage 之类的客户端存储；不加 DB 列与迁移；不新增事件名。
- 不做「恢复忽略」入口，也不做计划历史 / 版本切换。

## 二、已锁定的决策

1. **收尾改有条件**：提示词给判据——需要用户拍板才能定方向（多候选 / 需求不明 / 是否动手）时**先 `question`**，
   本轮不调用 `present_plan`；只有调研充分、方案具体到可落地步骤时才在末尾调用。
2. **忽略按次生效**：只让**这一次**计划不再弹表单；同一会话之后又出一份新计划，表单照常弹。
3. **条目即状态**：忽略 = 往会话文件追加一条 pi `custom` 条目（`customType: "ucode.plan-ignored"`）。
   不新增列、不新增旁路状态、不写客户端存储。
4. **判定沿用反向扫描**：`lastTurnPresentedPlan` 从列表尾往前扫，遇到 `user` 消息**或标记条目**即停（不弹），
   先遇到 `present_plan` 即弹。新计划在旧标记之后，扫描先遇到新计划 → 自然恢复弹出。
5. **多窗口同步不新增事件**：追加后广播既有的 `transcript_reset`，所有在线客户端（含发起方）重取快照。
6. **忽略后无残留**：表单整体收起（标记条目让 `planReady` 变 false），不留「批准并执行」入口。
7. **标记不进模型上下文**：pi 的 `custom` 条目只作扩展状态持久化，模型看不到这条记录；忽略也不触发新一轮生成。
8. **不改会话状态**：不 bump `updated_at`、不发 `session_updated`，会话列表排序与未读点不受影响。
9. **分叉继承**：分叉点落在该标记之后时，分叉复制条目会带上标记，同一段对话同样是「已忽略」；不做特例。
10. **服务端不做本地化**：标记条目的展示文案由客户端按 `customType` 渲染 `t("已忽略计划")`，
    服务端只写 `customType` 与 `data.at`。

**已否决的方案**（评审期间讨论过，勿再拾起）：

- **会话级 DB 列**（`session.plan_dismissed_at` + schema 版本 + `sessions/dismiss-plan` 路由）：
  粒度错了——它会让整个会话永远不再弹表单，与「按次生效」相悖；还要带迁移。
- **localStorage**：只对当前浏览器有效，跨端 / 跨窗口不一致，刷新后行为依赖键值，不允许。
- **新事件 `plan_dismissed` + `dismissedPlanIds` 旁路状态**（在消息列表响应里派生、在各端 store 里维护）：
  为了同步一份「条目里已经有的信息」而多维护一份状态；改为广播既有的 `transcript_reset` 后全部不需要。
- **`present_plan` 加必填参数**（`title` / `steps`）：模型多填一个不落地的字段没有收益，
  本轮「算不算计划」的判定也不靠它。

## 三、语义与 pi 接缝

| 能力 | API | 用途 |
| --- | --- | --- |
| 追加界面标记 | `SessionManager.appendCustomEntry(customType, data?) => string` | 追加 `{ type: "custom", customType, data }`，父为本轮叶子并前移叶子，返回新条目 id |
| 条目形状 | `CustomEntry`（`{ type: "custom"; customType: string; data?: T }`） | `customType` 标识来源；**不参与 LLM 上下文**（`buildSessionContext` 忽略） |
| 幂等判定 | `manager.getLeafEntry()` | 叶子已是本标记即不重复追加（比 `getLeafId()` + `getEntry(id)` 少一次查表） |
| 展示列表 | `manager.buildContextEntries()` | 压缩只裁压缩点之前的旧条目；`custom` 条目不在过滤之列 → `/messages/list` 能看到它 |
| 跨连接同步 | `services.events.emitFrame(sessionId, "transcript_reset", { fromEntryId })` | 复用阶段 9 的机制，客户端 `routeFrame` 收到即重取快照（不看 `seq`，载荷仅作说明） |

要点：

- **落点就是 pi 的会话 JSONL**：`$APP_HOME/agent/sessions/<id>.jsonl`（`env.sessionsRoot`，扁平一层），
  追加后文件里多一行 `{"type":"custom","customType":"ucode.plan-ignored","data":{"at":"…"},"id":"…","parentId":"…","timestamp":"…"}`；
  `parentId` 是本轮叶子，之后的用户消息以它为新父，**分支不分裂**。
- **manager 取法与 `/messages/list` 一致（两段式）**：池内有实例时用 `services.pool.get(sessionId)?.sessionManager`
  （内存里的叶子才是权威，此时另开 `SessionManager.open(...)` 会带着过期的叶子把标记挂到旁支）；
  池内没有实例时（生成结束、被 idle 回收后很常见）回退到
  `SessionManager.open(record.sourcePath, env.sessionsRoot, resolveSessionCwd(record))`——pi 的 `_buildIndex`
  以 JSONL 最后一行作叶子，append-only 保证最后一行就是活动分支尖端，因此安全。两者都不存在 → 400。
- **解析与追加之间不得有 `await`**：manager 取用、叶子检查、`appendCustomEntry`、`emitFrame` 全同步完成，
  并发的第二个窗口只会写一条。
- **草稿会话没有可写的文件**：`record.sourcePath` 为空（首轮回复完成前不落盘）→ 400；
  这类会话本来也不会出现决策表单，属防御分支。
- **追加是同步的**：叶子检查与 `appendCustomEntry` 之间没有 `await`，两个窗口同时点击只会写一条
  （第二次判为已忽略，返回 `ignored: false`）。
- `custom` 条目出现在消息列表里是**设计要的效果**（对话留痕）；`entryToDTO` 目前把它归入 `default → null`，
  只放行本项目的 `customType`，其它扩展条目的 `data` 继续不下发。

## 四、契约（packages/contracts）

- `src/constants.ts`：新增 `PLAN_IGNORED_CUSTOM_TYPE = "ucode.plan-ignored"`
  （跨端常量：服务端写、各端读；注释说明「忽略本次计划的界面标记」）。
- `src/messages/output.ts`：
  - `MessageDTO` 增加 `customType?: string`（custom 专用，界面据此区分界面标记与普通扩展消息）；
  - 新增 `MessageIgnorePlanResponse = SessionScoped & { ignored: boolean }`
    （`ignored` 表示本次是否真的写入，末尾已是标记时返回 `false`；先例：`MessageInterruptResponse.aborted`）；
  - **不新增 role**：`MESSAGE_ROLES` 与 pi 的 `AgentMessage` 角色对齐，标记复用 `custom`。
- `src/messages/input.ts`：**复用 `sessionIdInputSchema`**（与 `messages/interrupt` 同形），不新增 schema 与类型。
- `src/events.ts`：不改（复用 `transcript_reset`）。
- 错误码复用 `notFound` / `invalidRequest` / `sessionBusy`，不新增。

## 五、server 改动

- **`src/core/serialize.ts`**：`entryToDTO` 增加 `case "custom"` —— 仅当
  `entry.customType === PLAN_IGNORED_CUSTOM_TYPE` 时投影为
  `{ id, role: "custom", blocks: [], customType, createdAt }`；其它 `custom` 条目仍 `null`（现状不变）。
- **`src/routes/messages/index.ts`**：新增 `POST /ignore-plan`（`jsonBody(sessionIdInputSchema)`），顺序为
  1. 会话不存在 / 已归档 → `notFound`（404，`{ path: sessionId }`）；
  2. `services.pool.isActive(sessionId)` → `sessionBusy`（409，「会话正在生成，请先中断」）——
     生成中追加会把标记插进本轮中途，而本轮起点已定；
  3. 取 manager（池内优先，否则从 `sourcePath` open；两者都没有 → `invalidRequest` 400）；
  4. 叶子幂等：已是本标记 → `{ sessionId, ignored: false }`；
  5. `manager.appendCustomEntry(PLAN_IGNORED_CUSTOM_TYPE, { at: new Date().toISOString() })`
     → `services.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: entryId })`
     → `{ sessionId, ignored: true }`。
- 文件级注释与域说明补一句「忽略计划」。
- **无 DB / schema 变更**，不动 `updated_at`，不新增模块（逻辑就是一个路由处理器，不抽服务层）。

## 六、SDK 改动（packages/sdk）

- `src/apis.ts`：`messages` 组加 `ignorePlan(sessionId) =>
  transport.post<MessageIgnorePlanResponse>("messages/ignore-plan", { sessionId } satisfies SessionIdRequest)`。
- `src/stores/messages/index.ts`：`MessagesStore.ignorePlan(sessionId): Promise<void>` ——
  照 `compact` / `interrupt` 的写法（`patch(engine, { error: null })` → 调接口 → 失败
  `patch(engine, { error: asApiError(error) })`）。**不新增 store 状态**：刷新由 `transcript_reset` 驱动的
  `hydrate` 完成；`routeFrame` 在 hydrate 期间也照常处理该帧（缓冲重放不会丢它）。

## 七、前端改动（packages/ui）

- `src/lib/plan.ts`：新增 `isPlanIgnored(item)`（判 `item.customType`）；
  `lastTurnPresentedPlan` 的反向扫描加「遇标记即 `false`」。
- `src/business/message-item.tsx`：`role === "summary" | "custom"` 分支里，标记条目渲染
  `t("已忽略计划")`（沿用同一个 muted 便签容器，不带「（扩展消息）」前缀）。
- `src/hooks/use-chat.ts`：`ChatController` 增加 `ignorePlan: () => Promise<void>`（实现同 `stop` / `compact`）。
- `src/presets/workspace-layout.tsx`：新增 `ignorePlan()` 调 `chat.ignorePlan()`；`planReady` 一行不用改
  （标记判定已收进 `lastTurnPresentedPlan`）；把 `onIgnorePlan` 传给 `ChatPanel`。
- `src/business/chat-panel.tsx`：props 增加 `onIgnorePlan`，在渲染 `<PlanDecisionForm>` 处传 `onIgnore`。
- `src/business/plan-decision-form.tsx`：props 增加 `onIgnore`；footer 行序为
  `忽略`（`variant="ghost"`，最左，同位 `question-dialog.tsx` 的「跳过回答」）→ `提交反馈`（outline）→
  `批准并执行`（primary，`ml-auto`）；`title` 用「本次计划不再弹出决策表单」。（表单当前未接 `disabled`，
  且 `planReady` 已含 `!chat.streaming`，生成中本就不显示，故无需额外禁用逻辑。）
- 子会话不受影响（`showPlanForm = planReady && !isChild`）。

## 八、提示词、i18n 与文档

- **提示词**：`server/src/agent/prompt/locales/zh-CN.ts` 的 `modeConstraints.plan` 改为
  「需要用户拍板方向时用 `question` 提问，不要先写计划；方案具体到可落地步骤时才在末尾调用 `present_plan`」，
  且**不再承诺「反馈框」这类具体控件**（改说「用户在界面里批准或反馈」）。
- **工具说明**：`server/src/agent/tools/present-plan.ts` 的 `description` 与 `promptGuidelines` 补「不该调用的情形」；
  `execute()` 的返回文案改为「等待用户批准或反馈」。
- **评测**：`server/scripts/eval.ts` 增加可选反向用例 `plan-no-present`
  （`mode: "plan"`、`toolsNone: ["present_plan"]`，prompt 取「我想给这个项目加个新功能，你觉得加什么好？」这类
  无法直接成案的请求），与既有 `plan-present` 互为正反；两者都只报通过率。
- **i18n**：`packages/i18n/src/locales/ui/en.ts` 的 Plan decision 组加 `忽略: "Ignore"`、
  `已忽略计划: "Plan ignored"`、`本次计划不再弹出决策表单: "Stop showing the decision form for this plan"`；
  中文目录**不加**（key 即中文，zh-CN 里 key === value 会被 i18n 校验判为冗余条目）。
- **`docs/modes-and-permissions.md`**：plan 行的「用途」改写为「先调研出方案；方案成型时才以 `present_plan` 收尾，
  前端弹决策表单，可批准 / 反馈 / 忽略（忽略只对这次计划生效）」。
- **`docs/api.md`**：
  - 「路由与动作命名」的动作表登记 `ignore-plan`（语义「忽略本次计划的决策表单」，返回动作回执；
    这是动作表里首个带连字符的复合动词，按该表的「新增动作必须先登记」约定显式落表）；
  - 「事件流」的会话事件清单补 `transcript_reset`（载荷 `{ fromEntryId }`；编辑重发或追加界面标记后
    活动分支 / 历史已改变，客户端应重取快照，它不参与 `seq` 切分）。
- **`scripts/api-docs/endpoints.ts`**：messages 组加 `{ action: "ignore-plan", method: "POST",
  input: "sessionIdInputSchema", requestType: "SessionIdInput", output: "MessageIgnorePlanResponse",
  summary: "忽略本次计划的决策表单" }`，跑 `pnpm api:docs` 重生成 `docs/api-reference.md`
  （`scripts/verify/checks/api-docs.ts` 会核对一致性）。
- **`CHANGELOG.md`** 未发布：
  - 变更：plan 模式的 `present_plan` 收尾改为有条件（方案成型才收尾，需要拍板方向时先提问）；
  - 新增：计划决策表单支持「忽略」——往会话文件追加一条 `custom` 标记条目
    （`customType: "ucode.plan-ignored"`），对话区显示「已忽略计划」，多窗口靠 `transcript_reset` 同步；
    新增 `messages/ignore-plan` 接口与 `MessageDTO.customType`；无 DB 变更。
- 落地后在 `plans/agent-tools-and-modes.md` 阶段 2.5 的复盘里补一条（改了什么、为什么）。

## 九、测试与验收

**单元测试**：`server/src/core/__tests__/serialize.test.ts` 增加 `entryToDTO` 的 custom 分支两条用例
（标记条目 → `role: "custom"` + `customType`；其它 `customType` → `null`），文件级注释随之改为
「消息区块与界面标记条目的投影」。无新模块，故不新增测试文件（`scripts/verify` 的 tests 校验因此不受影响）。

**`pnpm check`**：biome + `-r typecheck` + `-r test` + `scripts/verify`（含 api-docs 与 i18n 校验）。

**真实浏览器走查**（`pnpm build` + `agent-browser` 打开 `http://127.0.0.1:2048`，或 `pnpm dev` 后开 `:5173`）：

1. 「了解这个项目，看看接下来可以做什么」→ **不弹**表单；
2. 让它出一份具体计划 → 弹 → 点「忽略」→ 表单收起、输入区回来、对话里出现「已忽略计划」便签 →
   刷新后仍不弹；
3. **同一会话再要一份新计划 → 表单重新弹出**（验证「按次生效」）；
4. **多窗口**：同一会话开两个窗口，A 点「忽略」，B 无需刷新即收起表单并出现便签；
5. 新会话里正常弹；
6. 落盘核对：`$APP_HOME/agent/sessions/<id>.jsonl` 出现 `"customType":"ucode.plan-ignored"`，
   其后下一条消息以该条目为 `parentId`（分支未分裂），且 `/messages/list` 里该条目为
   `role: "custom"` + `customType`。

## 十、风险与边界

- **提示词放宽会拉低既有评测通过率**：`plan-present` 本来就是 `optional` 用例（实测两源都会漏），
  新增的反向用例同样只能看通过率，不能当门禁。
- **没有「撤销忽略」入口**：标记条目永久留在会话文件里（分叉也会带走），刷新后同会话仍是「已忽略」。
- **压缩的极端情形**：若某次压缩的保留窗口恰好把计划轮与标记切开（需压缩点落在两者之间），
  两者会一并或一并不在展示列表里，判定仍然一致（都看不到计划 → 也不该弹）。
- **忽略后到 hydrate 完成前表单仍在**：`ignorePlan` 只调接口、不做本地乐观隐藏，收完全靠 SSE 的
  `transcript_reset → hydrate` 往返；这段时间可重复点击（第二次返回 `ignored: false`），SSE 断开则要等重连才收起。
  这是「无客户端状态」原则的必然结果，属有意行为。
- **不做回填**：本次之前产生的会话里没有标记条目，历史计划轮仍是「可决策」状态；符合「不做历史兼容」的约定。
- **`TODO.md` 的「隐藏 present_plan 卡片」仍未做**：忽略后会同时看到 `present_plan` 卡片与「已忽略计划」便签，
  观感待实测；若后续做卡片过滤，这条便签正好是保留的可读信号。
- **不改 `updated_at`**：忽略不算会话新动态，列表排序与未读点不动（副作用最小化）；
  若后续认为「留痕即新动态」，再评估发 `session_updated`。
- **不照搬 opencode v2**：其 plan agent 把计划写成 `~/.opencode/plan` 下的文件、持久决策落项目级配置规则，
  与本项目「计划只作为对话消息、决策按次生效」的语义不同；这里取的是它的思路（决策要可持久、可跨端一致），
  落了最轻的载体（会话条目）。

## 十一、落地顺序

1. 契约：`PLAN_IGNORED_CUSTOM_TYPE`、`MessageDTO.customType`、`MessageIgnorePlanResponse`；
2. `core/serialize.ts` 的 `custom` 分支 + `serialize.test.ts` 用例；
3. 路由 `POST /messages/ignore-plan`；
4. SDK：`apis.ts` 的 `ignorePlan` + `messages` store 动作；
5. UI：`lib/plan.ts` → `message-item.tsx` → `use-chat.ts` → `workspace-layout.tsx` →
   `chat-panel.tsx` → `plan-decision-form.tsx`；
6. i18n + 提示词 / 工具文案 + `eval.ts` 反向用例；
7. 文档：`modes-and-permissions.md`、`api.md`、`endpoints.ts` + `pnpm api:docs`、`CHANGELOG.md`；
8. `pnpm check` + 浏览器走查 + 落盘核对 → 停下等 review（未获批准不提交）。
