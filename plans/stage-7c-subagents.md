# 阶段 7c-1 · 子智能体

> 计划母文档：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 7c（子智能体部分）。
> 参考：[opencode `task`](https://opencode.ai/docs/agents/) 与 [pi-subagents](https://pi.dev/packages/pi-subagents)。
> 本文只覆盖子智能体；goal 模式、7d（统计 / 编辑历史）、会话分叉不在此文（分叉只在「口子」一节交叉引用）。
>
> 状态：**已完成**（7c-1a ~ 7c-1d-b；7c-1d-c 暂缓，不放开嵌套），进度以母文档
> [`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 的进度表为准。

## 一、核心原理（已确认）

> **子智能体 = 由父会话工具调用触发、能力被「父会话 ∩ 角色定义 ∩ 全局策略」夹住、只回传最终文本的独立会话。**

四层含义：

1. **子会话是完整会话**：独立上下文、独立系统提示词、独立工具集与权限、独立事件流；能落盘、能被单独打开。
2. **父会话只拿最终文本**：子会话中间翻了什么、调了什么工具，不进父会话上下文（这是上下文隔离的意义）；要看就进子会话看。
3. **能力取交集、只可收窄**：`子会话能力 = 父会话能力 ∩ 角色定义 ∩ 全局策略`。这保证「计划模式只读」等父约束在委派后不被绕过——否则只读父只要调一个全量角色子智能体就越权了。
4. **前台执行**：pi 的工具执行是同步 Promise，父循环等待子会话跑完再继续。后台（独立 run + 通知）留后续。

实现上完全复用现有链路：子会话就是又一次 `pool.ensure` → `buildSessionOptions` → `createAgentSession` → `session.prompt`，
只是触发者从用户变成父会话里的 `subagent` 工具调用；`execute(toolCallId, args, signal)` 里 spawn、等待、取最终文本回传。

## 二、参考取舍

**取自 opencode（内核）**：子会话是真实会话（`parentID`、持久化、主列表隔离、可导航）；角色选择 `general` 全量 / `explore` 只读；
权限按「父 deny + external ∪ 子规则」派生；模型 / 档位缺省继承父会话；中止传播 `ctx.abort`；卡片嵌套进度 + 进子会话 + 嵌套审批归属祖先。

**取自 pi-subagents（原则，不抄平台）**：

- **能力上限不可放宽**（`tools ∩ ceiling`）→ 落地为上面的「交集」。
- **角色即数据**：`AgentProfile`（提示词 + 工具档位 + 权限 + model/thinking）。
- **`fresh` 默认、`fork` 可选**（真分叉父会话记录）。
- **预算意识**：并发、最大深度、每会话 spawn 上限。
- **可观测**：子会话事件是唯一进度源，不发明 stdout 协议。

**明确不抄**（见末节「明确不做」）：workflows/chains/parallel 脚本、missions/schedules、外部 CLI runner、Herdr 机器、
worktree 隔离、acceptance/typed gates、per-agent memory、refinement overlays、profile 目录生成、FleetView/artifact 全套。

## 三、已锁定决策

- 核心原理与「能力取交集」见第一节。
- 能力模型：**统一 `AgentProfile`（primary / subagent）+ 交集**；primary = 现有 build / plan / ask，subagent 起步 `general`（继承父能力）、`explore`（只读）。
- 执行：**前台**（父会话等待子会话返回）；后台后续。
- 上下文：**`fresh` 为默认**；`fork` 只留接口与口子，与后续「会话分叉」功能共用同一原语。
- 子会话：**落盘**（`session.parent_session_id`）、**不进主列表**、可下钻导航。
- 角色选择：模型在工具入参里选（`agent`），由角色描述引导；后续支持用户 @ 指定。
- 结果回传：最终文本 + `task_id`（为 resume 留）。
- 审批 / 提问：**归属根会话**并标注来源（v1 只禁一层递归，故根即父；放开嵌套时沿父链解析到根）。
- 自定义 agent：**v1 支持**，来源为 `$APP_HOME/agent/agents/*.md`（frontmatter + 提示词正文），放 7c-1d。
- 角色清单：起步 `general` + `explore`；其余角色（oracle / reviewer / worker 等）随自定义 agent 一并可用。

## 四、架构分层

```
agent/
  agents/                 # 角色注册表：primary + subagent 共用 AgentProfile
    profiles.ts           # 内置角色（build/plan/ask/general/explore）
    custom.ts             # 自定义 agent 的发现与解析（7c-1d）
    capability.ts         # 能力交集：工具集 ∩、权限取较严、model/thinking 解析
  subagents/              # 子会话运行时
    tool.ts               # subagent 工具
    spawn.ts              # spawn → prompt → 取文本 → 回收
    context.ts            # fresh / fork 策略（fork 留口子，与会话分叉共用）
  session-config.ts       # 装配层：从 AgentProfile + 父能力解析出会话参数
```

一次 `subagent` 调用的时序：

```
父会话 agent 循环
  └─ 模型调用 subagent({ agent, task })
       └─ tool.execute(toolCallId, args, signal)
            ├─ resolveCapability(父能力, 角色)       # 工具集取交集，权限取较严
            ├─ pool.ensure(新建子会话 id, 上述能力)   # 落盘、接入事件总线
            ├─ 转发子会话事件为 subagent_* 帧（7c-1b）
            ├─ child.prompt(task) → 等待 agent_settled
            └─ 取最后一条 assistant 文本 → 回传 tool result（+ task_id）
```

## 五、AgentProfile 与能力交集

### 类型

```ts
type AgentCapability = {
  /** 工具档位；`inherit` 表示沿用父会话解析后的工具集（general 用） */
  toolSelection: ToolSelection | { kind: "inherit" };
  /** 角色附加的权限规则 */
  permissions: readonly PermissionRule[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

type AgentProfile = {
  slug: string;                       // "build" | "plan" | "ask" | "general" | "explore" | 自定义
  kind: "primary" | "subagent";
  label: string;                      // 展示名，界面文案走 i18n（自定义 agent 用 description）
  description: string;                // 供 subagent 工具描述 / 广告位
  promptSection: string;              // 角色提示词约束（内置走语言目录，自定义走 frontmatter 正文）
  capability: AgentCapability;
  /** 仅 subagent：能力上限（只可收窄）；7c-1d 启用，v1 未接线 */
  limits?: { maxDepth?: number; allowedAgents?: readonly string[] };
  /** 是否在父系统提示词里列出（广告位，v1 可先只在工具描述里列） */
  advertise?: boolean;
};
```

内置角色：

| slug | kind | 工具档位 | 说明 |
| --- | --- | --- | --- |
| `build` | primary | 现有默认集 | 不变 |
| `plan` | primary | 现有只读集 | 不变 |
| `ask` | primary | 现有只读集 | 不变 |
| `general` | subagent | `inherit` | 继承父会话能力，适合「帮我在这条线上干活」 |
| `explore` | subagent | 只读集 | 只读侦察 / 评审，任何父下都是只读 |

### 交集规则

- **工具集**：先解析父会话的实际工具名集合 `parentTools`，再解析角色：`inherit` → `parentTools`；白名单 → 白名单；`defaultTools` → 其默认集。
  结果 `= parentTools ∩ 角色集`，并**始终移除** `subagent` / `present_plan` / `remember` / `forget`（递归与父专属能力不进子会话）。
- **权限**：父判定与角色判定各算一次，取**较严者**（复用 `engine` 里的 `SEVERITY` / `strongest` 思路），再追加一条 `subagent: deny`。
  这样父的 `deny` / `ask` 永远压得住角色的 `allow`，角色不可能放宽父的限制。
- **model / thinking**：`工具入参 > 角色定义 > 父会话`；后续叠加全局 model scope 上限（收窄）。
- **深度 / allowedAgents**：从父能力继承并只可收紧；v1 默认 `maxDepth = 1`（子会话不再有 `subagent` 工具）。

## 六、契约与 DB

### DB（追加迁移）

- `SCHEMA_VERSION` 递增，迁移：`ALTER TABLE session ADD COLUMN parent_session_id TEXT;`
  `ALTER TABLE session ADD COLUMN agent TEXT;`（子会话记录角色 slug；primary 为空）
  与对应索引。
- `SessionRecord` / `SessionSummary` 增 `parentSessionId: string | null`、`agent: string | null`。
- `session-repository`：`createChild(parentId, { cwd, agent, mode, name })`；`SessionSearchInput` 增
  `parentSessionId?: string | null`（默认 `null` 只出根会话）。

### 契约 `@ucode/contracts`

- `sessions/output.ts` / `input.ts`：`SessionSummary.parentSessionId` / `agent`；列表入参 `parentSessionId?`。
- `interactions/output.ts`：`PermissionInteraction` / `QuestionInteraction` 增
  `sourceSessionId?: string`、`sourceDescription?: string`（子会话来源标注）。
- `events.ts`：`subagent_start` / `subagent_event` / `subagent_end`（7c-1b）。
- `constants.ts`：若需跨端共享的内置子角色枚举，再议；v1 角色清单主要在 server（自定义 agent 是运行时数据）。

### 常量

- `SUBAGENT_MAX_CONCURRENCY`（单父并行上限，推荐 4）
- `SUBAGENT_TIMEOUT_MS`（单次时限，推荐 10 分钟）
- `SUBAGENT_DESCRIPTION_MAX_LENGTH`（推荐 60）
- 最大嵌套深度 `SUBAGENT_MAX_DEPTH` 留到 7c-1d 放开嵌套时再加（v1 靠「子会话工具集不含 `subagent`」实现禁递归）

## 七、子阶段

| 子阶段 | 内容 | 依赖 | 契约 / DB |
| --- | --- | --- | --- |
| 7c-1a | 内核：AgentProfile + 能力交集、装配层重构、`subagent` 工具、general/explore、落盘与列表隔离、权限交集与来源标注、前台 / 中止 / 超时 / 并发 | — | 契约 + DB |
| 7c-1b | 流式子会话进度：`subagent_*` 帧 + 工具卡内联渲染 | 1a | 契约（事件名） |
| 7c-1c | 子会话导航：侧栏下钻 / 进入子会话 / 归档级联 | 1a | 契约（列表过滤） |
| 7c-1d-a | 自定义 agent（`$APP_HOME/agent/agents/*.md`） | 1a | — |
| 7c-1d-b | resume（`task_id` 续跑） | 1a | — |
| 7c-1d-c | 深度 / spawn 预算（含交互沿父链解析到根） | 1a | — |
| 7c-1d-d | fork 口子（并入后续「会话分叉」阶段） | 1a | — |

### 7c-1a · 内核

- `agent/agents/profiles.ts`：内置 `AgentProfile`（primary 复用现有工具集与权限；subagent general/explore）。
- `agent/agents/capability.ts`：`resolveCapability(parent, profile)`（工具交集、权限较严、model/thinking 解析、深度收紧）。
- `agent/session-config.ts` 重构：入参从「`mode: SessionMode`」改为「已解析的 `AgentProfile` + 可选父能力」；
  提示词约束从 `MODES` 索引改为读 `profile.promptSection`（语言目录里按 slug 存）。
  这是**行为保持型重构**，由现有 `session-config.test.ts`（TS-01/02、S-01/02、记忆用例）兜底。
- `agent/prompt/`：`PromptCatalog.modeConstraints` → `agentConstraints`（键为角色 slug，中英齐平）；
  新增 `subagent` 工具策略分节（委派引导：task 必须自包含；子会话看不到当前对话）。
- `agent/subagents/tool.ts` / `spawn.ts`：`subagent({ agent, task })`；spawn 走 `pool.ensure`；返回
  `task_id: <id>\n\n<task_result>…</task_result>`；中止（工具 signal）→ `child.abort()`；超时与并发按常量。
- `agent/tools/index.ts`：`buildCustomTools` 按工具名集合注册（消掉现有「`MODES` 与 `CUSTOM_TOOL_NAMES` 成对维护」的耦合）。
- 扩展加载按能力：只有**继承默认工具集**的会话（build 主会话、`general` 子会话）挂 MCP / `tool_search`；
  `explore` 与只读模式下的子会话不连（够不着扩展工具，且 MCP 会激活 codemode）。
- `modes/index.ts`：primary 的 `subagent` 进工具集（子会话继承时被交集移除，故子会话天然无 `subagent`）。
- `core/pool.ts`：子会话跳过记忆回顾订阅；交互钩子绑定根会话；根会话构造 `subagents` 钩子传入装配。
- `agent/permissions/`：判定支持「父判定 + 角色判定取较严」；`subagent: deny` 兜底。
- `core/interactions.ts`：透传 `sourceSessionId` / `sourceDescription`；前端弹窗标注「来自子智能体：<描述>」。
- `routes/sessions`：列表默认只出根会话；`parentSessionId` 取子会话。

**测试**：SUB-01 空角色工具集（general 继承父、explore 只读、都无 subagent）；
SUB-02 能力交集（plan 父 + general = 只读，不能越权；build 父 + explore = 只读）；
SUB-03 装配行为保持（复用现有 TS/S 用例）；SUB-04 并发上限；SUB-05 中止 / 超时；
SUB-06 仓储父子与列表过滤；SUB-07 交互来源；SUB-08 真实模型冒烟；SUB-09 浏览器来源标注。

**7c-1a 复盘（落地时的偏差）**

- 用统一的 `AgentProfile`（primary + subagent）替换了原 `agent/modes/`：装配层从「按 mode 索引」改为
  「按已解析的角色能力」，`buildCustomTools` 从「按 mode 分支」改为「按可用工具名集合注册」，
  消掉了「声明与注册成对维护」的隐性耦合。
- 权限交集没有退化成「合并规则表」，而是在 `tool_call` 拦截时对「角色判定」与「父会话判定」取较严者
  （`severityOf`），保证只读父不会靠委派放宽。
- MCP / `tool_search` 的加载门控从「`mode === build`」收紧为「`mode === build` 且继承默认工具集」：
  `explore`、只读模式下的子会话不再白连 MCP。
- 子会话经会话池创建（而非裸 `createAgentSession`），因此天然落盘并接入事件总线；结束时依次回写索引、
  结算来源交互、回收实例。
- 真实模型端到端验证通过（build 父委派 `explore`，子会话落盘并产出结论、父会话贴回）；随后补了 4 项硬化：
  子会话内部报错归一为可读文案、`model` 覆盖显式校验、装配失败删行（带 `source_path IS NULL` 守卫）、
  失败路径也回写索引并结算交互；另修 `ensure` 创建后失败的会话泄漏。
- 已知：SUB-04「并发上限」目前只有实现、未在池层单测；7c-1b（流式进度）与 7c-1c（导航）未开始；
  `fork` 上下文接口已留并接线（当前固定 `fresh`，非 fresh 时失败关闭）。

### 7c-1b · 流式子会话进度

- `subagent_start { toolCallId, sessionId, description }` / `subagent_event { toolCallId, sessionId, event }` /
  `subagent_end { toolCallId, sessionId, isError }`，由 `spawn.ts` 订阅子会话事件后经父会话总线发出。
- 前端 `use-session-stream` 收集 `subagent_*`，`MessageList` 传给对应工具卡；卡片内联渲染子会话的工具调用与文本，可折叠。
- 验收：父流式期间实时显示子进度；刷新后由 `messages/list` 投影重建。

**7c-1b 复盘（落地时的偏差）**

- **不重发子会话事件，只发关联帧**：原设计是 `spawn.ts` 订阅子会话事件、经父会话总线重发 `subagent_event`。
  落地时改为只发 `subagent_start` / `subagent_end` 两个关联帧（契约只加这两个事件名，无 `subagent_event`）：
  子会话自身的帧从 7c-1a 起就已挂在同一条 `/events` 总线上按其 `sessionId` 广播，重发会让每个子 token 在
  同一条流上发两遍。前端 `use-session-stream` 用 `childId → toolCallId` 映射把子帧直接归入嵌套视图。
- 进度**不落盘**：刷新 / 重连不重建嵌套进度（与「事件不落盘、刷新重取快照」一致）。中途刷新会丢掉
  `subagent_start`，正在跑的子会话嵌套为空，直到外层结果卡出现；查看完整过程留给 7c-1c 导航。
- 前端把嵌套进度挂在**工具结果卡**（role `tool`）上，不挂 assistant 里的 toolCall 声明块，避免同一调用两份。
- 顺带修一处会随本功能显性化的 UI 缺陷：工具结果项在 `message_end` 合并时 `id` 从 `live-tool-*` 换成服务端 id，
  按 `item.id` 作 React key 会重挂、把展开的嵌套卡收起；改为工具项按 `toolCallId` 作 key。
- 验收：`pnpm check` 全绿（173 单测 + 6 项约定校验）；真实模型浏览器走查——build 父委派 `explore`，
  运行中工具卡实时显示子会话的 `ls/find/read` 与文本、结束后保留展开态并显示完整结论，审批弹窗带「来自子智能体」。

### 7c-1c · 子会话导航

- 侧栏父条目下钻列子会话；进入子会话切到该会话视图，有「返回父会话」；归档父会话级联归档子会话。
- 子会话重新打开时按 `parent_session_id + agent` 还原能力（v1 深度 1：父是主会话，取 `MODES[父.mode]` 与之交集）。
- 验收：进出子会话；归档级联；刷新保持。

**7c-1c 复盘（落地时的偏差）**

- 子会话视图**只读**：计划只说「进入子会话切到该会话视图」，落地明确为不发消息——输入区替换为只读提示。
  因此子会话不会独立在跑，级联归档无需处理「运行中的下属」，`archive` 只对整棵子树做一次忙碌校验即可。
- 侧栏下钻的显隐依据用 **`SessionSummary.childCount`**（契约新增；SQL 关联子查询数未归档的直接子会话），
  仅在有子会话时显示展开箭头；搜索期间收起子会话，避免未参与过滤的子项混进结果。
- 级联归档落在 `routes/sessions` 的 `archive`：`SessionRecord.descendantIds`（BFS 收集整棵子树，含已归档、
  带环兜底）逐个 `dispose` / `events.remove` / `interactions.forget` / `permissions.clear` / `archive`；
  归档确认在有子会话时用「一并归档」文案。
- **当前会话解析改为经 `sessions/info`**：子会话不在主列表，旧的「不在列表即清空」会把它立刻清掉。
  新的 `useActiveSession`：主列表有就直接取，否则请求详情，`deletedAt` 或确认不存在（404 / id 非法）才清空，
  网络类临时故障保留选中项。为此顺带修服务端一处：`sessions/info` 此前对不存在的会话返回**合成的草稿摘要（200）**，
  改为 404——草稿会话也有 DB 行，据此把「无行」与「有行未落盘」区分开，否则「点进子会话刷新」与
  「URL 里已消失的会话」都会渲染成空会话。
- 子会话入口补了工具卡一处：`SubagentStream` 增 `sessionId`（取自 `subagent_start`），
  在工具结果卡的嵌套进度里给「打开子会话」；仅实时可见，刷新后进度不重建（沿用 7c-1b 边界）。
- 顺带 UX：直接打开 / 刷新子会话时自动展开其父级，让当前项在侧栏可见。
- 侧栏把逐项回调收敛为一个 `renderItem`，`SessionProjectGroup` 不再透传 `activeId` / `onSelect` 等。
- 「重开还原能力」这条在 7c-1a 的 `pool.resolveAgent` 已实现，本次未改，由既有 SUB-01/02 用例兜住。
- 验收：`pnpm check` 全绿（176 单测 + 6 项约定校验）。真实模型浏览器走查——build 父委派 `explore` →
  侧栏出现展开箭头 → 展开见子会话 → 进入（URL `?session=sub-…`、返回按钮、只读页脚、子会话转录）→
  返回父会话 → 直接刷新子会话 URL 仍保持且父级自动展开 → 工具卡「打开子会话」跳转成功；
  归档父会话弹「一并归档」确认，确认后子会话 `deletedAt` 落库、列表清空、子会话视图自动退出。

### 7c-1d · 自定义 agent / resume / 深度 / fork 口子

- 自定义 agent：`$APP_HOME/agent/agents/*.md`，frontmatter（`name` / `description` / `tools` / `model` / `thinking` / `advertise` 等）
  + 提示词正文；`agent/agents/custom.ts` 发现与解析；与内置 profile 合并（同名覆盖）；设置页编辑后续再接。
- 更多内置角色（oracle / reviewer / worker 等）随自定义能力自然可得；内置只保 general + explore。
- `resume`：`task_id` 命中「本父会话的子会话」则继续（校验归属）；`spawn` 支持传入已有子会话 id。
- 深度 / 预算：放开非根父的 `subagent`（`maxDepth` / `allowedAgents` / spawn 上限），交互沿父链解析到根。
- `fork` 口子：`agent/subagents/context.ts` 定义 `fresh | fork` 策略接口；fork 走 pi `SessionManager.branch` / `forkFrom`。
  v1 只实现 `fresh`；`tool` 入参不暴露 `fork`，接口留在内部，待「会话分叉」一并落地。

**7c-1d-a / 7c-1d-b 复盘（落地时的偏差）**

- 本次只落地 **7c-1d-a（自定义 agent）** 与 **7c-1d-b（resume）**；深度 / 预算（7c-1d-c）与
  fork 口子（7c-1d-d，并入「会话分叉」）留作后续独立阶段，子阶段表已相应拆分。
- frontmatter 复用 pi 主入口导出的 `parseFrontmatter`，**不新增 yaml 依赖**。
- `tools` 语义定为「缺省 / `inherit` 继承父能力 + 显式名单白名单」；交集仍在装配时算。
  YAML 空键（`tools:` 解析为 `null`）按**失败关闭**报错，不退回 `inherit`——退回继承恰好是放大能力。
- frontmatter 改 `.strict()` + 逐字段中文错误 + 未闭合分隔符单独提示：`tool:` / 全角冒号这类拼写错误
  必须报错，不能把 `tools` 静默丢成「继承父会话全量工具」。为此 `custom.test.ts` 显式断言了错误文案。
- 自定义角色**仅 subagent**、不新增主模式；与主模式同名拒绝，与内置 `general` / `explore` 同名覆盖。
- 注册表按 `agentDir` 现读（`loadAgentRegistry`）：`pool.ensure` 每次读一次，用户改文件后新建 / 重开会话即生效。
  坏文件只进 `registry.errors` 并 `logger.warn`，客户端暂无反馈（设置页后续）。
- 目录只认普通文件（`readdirSync(..., { withFileTypes: true }).isFile()`）挡符号链接；大小上限先 `statSync` 再读。
- 角色声明的 `model` 若不可解析，装配阶段直接报错，不静默回落默认模型（与 `subagent` 入参 model 的校验对齐）。
- resume：`subagent` 增可选 `task_id`，命中「本会话的直接子会话」则复用（校验归属 / 角色一致 / 未归档），
  未指定 `agent` 时沿用原子会话角色；续跑时装配失败不再 `discardChild`（行早已存在，不能当空行删）。
  `model` / `thinkingLevel` 只在新建时写入子会话行，续跑携带会被**显式拒绝**（而不是静默忽略）。
- `advertise: false` 只影响工具描述，角色仍留在 `agent` 入参枚举里（隐藏但可按名调用）；
  为此装配层传**全量**子角色给 `subagent` 工具，过滤只发生在工具层一次。
- 已知边界：删 / 改角色文件会让已有子会话重开时报「未知角色」（失败关闭，不静默换成别的角色）；
  自定义角色无法声明 permissions（只读只靠 `tools` 白名单，同名覆盖 `explore` 不继承内置只读规则）；
  角色文件错误只进日志；提示词正文无质量下限。
- 验收：`pnpm check` 全绿（197 单测 + 6 项约定校验）。真实模型 E2E（临时脚本，已删）——
  注册表解析出自定义 `reviewer`，`subagent` 工具委派后返回 `task_id`，带 `task_id` 续跑复用同一子会话（`E2E OK`）。

## 八、与 pi「会话树 / 分叉」的关系（口子）

pi 的三个命令落在两个不同的树上，先分清，避免把「条目树」和「子智能体」混为一谈：

- 会话文件内部，条目以 `id`/`parentId` 组成**条目树**，模型只收到「当前叶子 → 根」这条活动分支。
- `/tree`：在**当前会话文件内**移动 / 原地分支（编辑早前消息重发，旧分支保留）。
- `/fork`：从选中节点**新建会话文件**，头里 `parentSession` 指向原会话（会话级链接）。
- `/clone`：复制当前活动分支成新会话。

与子智能体的关系：

- **不同轴**：`/tree` 是同一段对话的分支探索；子智能体是**另一段独立对话**（独立提示词 / 工具 / 上下文），由工具调用触发、只回传最终文本。
- **连接点**：子智能体的 `context: "fork"` 就是从父会话分叉出一个子会话，用的正是 pi 的
  `SessionManager.branch` / `forkFrom` 原语；嵌套子智能体则形成**跨会话的父子树**（会话关系树），
  与 pi 的条目树是两棵树，需要各自的 UI。

映射到我们的排期：

| pi 能力 | 对应我们的功能 |
| --- | --- |
| `/tree`（原地分支 + 编辑重发） | 7d「编辑历史」 |
| `/fork`（新会话） | 独立的「会话分叉」阶段（已排：紧随 7c-1 之后） |
| `/clone` | 暂不做 |
| 子智能体 `fork` 上下文 | 复用 `/fork` 那一层原语 |

建议抽一层共享能力 `agent/fork/`（给定源会话 + 分叉点 → 新会话文件 + 会话级 parent 链接），供
「子智能体 fork 上下文」与「用户侧会话分叉」共用；`/tree` 的原地分支（`context_edit`）归 7d 编辑历史，另算。
本阶段只在 `agent/subagents/context.ts` 留 `fresh | fork` 策略接口，不实现 fork 行为。

## 九、验收标准（整阶段）

- `pnpm check` 全绿；装配层重构后现有行为零回归。
- build 父可委派 general（能读写）与 explore（只读）；plan / ask 父委派的任何角色都只读（交集生效，不能越权）。
- 子会话落 JSONL 且带 `parent_session_id` / `agent`；主列表默认不列；子会话不能再派子会话。
- 子会话触发的审批 / 提问在父会话前端出现并标注来源，能正常答复。
- 父中止 / 子超时后子会话被回收，无泄漏。
- 7c-1b 起进度内联流式；7c-1c 起可导航进出；7c-1d 起可自定义 agent / resume。

## 十、风险与边界

- **装配层重构面较大**：`session-config` 从按 `mode` 索引改为按 `AgentProfile`，必须靠现有测试兜住零回归；
  建议 7c-1a 的第一笔就把「行为保持」单测跑通再往下做。
- **审批归属是权宜**：v1 禁一层递归，交互绑根会话即可；7c-1d 放开嵌套时必须沿 `parentSessionId` 链解析到根，
  不要退回按子 sessionId 发帧（那会重演 opencode 反复修的子树路由问题）。
- **能力继承意味着子会话可能写盘**：并发子会话改同一目录有冲突风险（与 opencode 相同），靠提示词与用户约束，不做文件锁。
- **模型 token**：子会话消耗计入各自会话，统一统计留 7d。
- **fork 的上下文成本与签名块**：fork 会把父上下文带给子会话（pi-subagents 会剥离 Anthropic 签名 thinking 块），
  且父上下文可能很大；这也是把 fork 留到「会话分叉」一起设计的原因之一。

## 十一、明确不做

- 后台 / 常驻子会话、多轮复用、steer / stop / detach。
- workflows / chains / parallel 编排脚本、missions / schedules。
- 外部 CLI runner（codex / claude-code / cursor）、Herdr 机器、远程执行。
- worktree 隔离、acceptance / typed gates、tool / usage budget、FleetView / artifact / transcript 全套。
- per-agent memory、refinement overlays、profile 目录生成。
- goal 模式与 7d（统计 / 编辑历史）。
