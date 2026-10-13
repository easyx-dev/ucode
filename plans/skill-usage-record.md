# 技能命中的记录：ucode.skill 条目与 read 卡片上的标记

> 依赖：[`input-commands-skills.md`](./input-commands-skills.md)（技能资源的发现、`/skill:name` 双通道、
> 清单由 pi 注入系统提示词）、[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 7 的
> `ucode.*` 观测记录一族（条目登记见 [`docs/session-entries.md`](../docs/session-entries.md)，
> 校验见 `pnpm verify` 的 `session-entries`）。
>
> 状态：**未开始**（计划定稿，待实施）。

## 一、背景与目标

pi 的技能是「提示词清单 + 模型自己读文件」的机制，不是工具调用。`dist/core/skills.js` 的
`formatSkillsForPrompt` 把可用技能（name / description / location）拼成 `<available_skills>`，
`dist/core/system-prompt.js:99-103` 把它挂进系统提示词，提示里写明「任务匹配描述时用 `read` 读该文件」。

于是两条通道在会话里都没有可辨认的痕迹：

- **自动命中**：模型发起一次普通的 `read`，参数是 `SKILL.md` 的绝对路径——界面上与任何一次读文件无异，
  会话文件里也只有那条 `toolCall` 与它的结果；
- **显式调用**：`/skill:name` 被 pi 的 `_expandSkillCommand` 换成 `<skill name="…" location="…">` 块
  （`dist/core/agent-session.js:1629-1642`），用户消息因此在界面上有一个 chip
  （`packages/ui/src/lib/message-chips.ts` → `business/user-message.tsx`）——但那是渲染同一个文本块的
  结果，不是一条可统计的记录。

**目标**：把「哪个技能、谁选的、什么时候用的」变成会话文件里的一条记录，并在命中那一次的 `read`
调用上标出来——不给界面加新形态的行。

**做**：

- 新增 `ucode.skill` 条目（`custom`，与 `ucode.permission-decision` / `ucode.step` 一族），两个来源：
  `hit`（模型自动命中）、`invoke`（显式 `/skill:name`）；
- `hit` 下发客户端，标记挂到对应的 `read` 调用卡片上（它本来就在「读取 ×n」的聚合行里）；
- 同步 `docs/session-entries.md` 的登记、`CHANGELOG.md` 的 `[未发布]` 条目与 `pnpm api:docs` 生成的接口文档。

**明确不做**：

- 不新增行类型、不加分隔细线：`chat-rows.ts`、`message-row.tsx`、`message-list.tsx`、`divider-line.tsx`
  都不动；
- 不改 `commands/list`、不新增接口、不动技能目录优先级与广告口径；
- 不做用量面板的技能聚合（数据先落盘，聚合与展示另行决定）；
- 不识别 `bash cat SKILL.md` / `grep` 这类非 `read` 的读取路径；
- 不为老会话回填记录（没有条目就是没有记录，界面自然不显示）。

## 二、范围界定

| 场景 | 现状 | 本次 |
| --- | --- | --- |
| 模型自动命中（读 `SKILL.md`） | 完全无痕，界面上就是一次读文件 | 写 `ucode.skill`（`event: "hit"`，带 `toolCallId`），下发界面，并在那次 `read` 卡片上标出技能名 |
| 显式 `/skill:name` | 会话文件里有 `<skill …>` 块，界面有 chip，无结构化记录 | 写 `ucode.skill`（`event: "invoke"`），**不下发界面**（chip 已经表达了这件事） |
| `disable-model-invocation` 的技能 | 不进系统提示词，只能显式调用 | 不特殊处理：显式调用照记 `invoke`，模型自然不会 `hit` |
| 子会话（`subagent`）里的命中 | 无痕 | 记在子会话自己的 JSONL 上，不向父会话汇总 |
| 老会话 / 已归档会话 | 无记录 | 不回填、不迁移 |

## 三、已锁定的决策

1. **两个来源合用一个条目类型**：`SKILL_RECORD_CUSTOM_TYPE = "ucode.skill"`，用 `event` 区分
   `hit` / `invoke`——两者的读取方与生命周期完全一致，拆成两种条目只会多一份登记与白名单。
2. **`hit` 必带 `toolCallId`**（`tool_execution_start` 本就带它）。界面靠它把技能标记挂到对应的工具卡上，
   而不是另起一行。
3. **命中标记挂在工具卡上，不新增行**：`read` 已经在「读取 ×n」的聚合行里，技能名是那次调用的属性；
   为它加一条细线等于对同一个事实多占一行。
4. **`invoke` 只落文件、不下发**：`serialize` 只放行 `event === "hit"` 的条目，前端拿到的技能条目必然
   都是命中。用户消息上的 chip 已经是显式调用的呈现，界面上再来一遍没有信息量。
5. **每轮同一技能只记一次**：模型分片读同一个 `SKILL.md`（`offset` / `limit`）时只留第一条，轮次边界用
   `turn_start` 清空；跨轮再次命中再记。
6. **命中渠道只认 `read`**：含 codemode 里的嵌套调用（`dist/core/nested-tool-calls.js:110-116` 走同一个
   `tool_execution_start`，带 `parentToolCallId`）。`bash cat` / `grep` 读技能文件不识别——pi 广告给模型的
   渠道就是 `read`，按别的路径猜会引入误报。
7. **条目为 `custom`**：不进模型上下文；写失败只记日志，不影响这一轮（与 `recordPermissionDecision`、
   `StepTelemetry.flush` 同一姿态）。
8. **技能索引复用会话自己那个 resourceLoader**：`session-config` 已经为每个会话 `loader.reload()` 过，
   广告给模型、`/skill:name` 展开、我们的记录必须取自同一份 `loader.getSkills()`——另起一次装载会让
   「界面列出的」「pi 认的」「记录里的」出现三份口径（`harness/setup/assets/index.ts` 的文件头注释正是这条约束）。
9. **不新增事件名**：条目写完后发既有的 `transcript_reset` 帧（`fromEntryId`）让在线客户端重取快照，
   与审批记录、压缩完成同一做法。

## 四、pi 侧接缝与必须处理的坑

**接缝**：

- `tool_execution_start` 的载荷是 `{ toolCallId, toolName, args, parentToolCallId? }`
  （`dist/core/extensions/types.d.ts` 的 `ToolExecutionStartEvent`，`AgentSessionEvent` 原样透传）；
  会话池的事件订阅（`core/pool.ts:682`）已经收着它，不必再挂扩展。
- pi 的 `read` 入参是 `{ path, offset?, limit? }`（`dist/core/tools/read.d.ts` 的 `readSchema`）；
  技能清单里的 `location` 就是 `SKILL.md` 的绝对路径（`formatSkillsForPrompt` 原样广告它），两者可比对。
- 显式调用在我们这一侧就能认出：pi 的判据是 `text.startsWith("/skill:")`（`agent-session.js:1629`），
  取到名字再查一次技能索引即可。

**坑**：

- **孤儿命中**：调用记录被压缩裁剪、或不在当前分支时，`toolCallId` 找不到对应的工具卡。此时标记无处可挂，
  直接丢弃——绝不因为标记而生成孤立行。
- **路径归一**：模型可能给绝对路径、`~` 开头或相对 `cwd` 的路径。统一「展开 `~` → 相对 `cwd` 解析 →
  `realpath`」；拿不到 `realpath`（文件已删 / 权限不足）时退化为字符串比较。
- **分片读**：同一次命中的多次 `read` 只有第一次带标记（见决策 5），其余不重复。
- **刷新代价**：`transcript_reset` 会让在线客户端重取快照，生成中途多一次历史重取——与 threshold 压缩
  完成时的既有行为同级；换来的是命中立刻可见（否则要等本轮落定）。
- **顺序**：`invoke` 的记录写在投递之前，排在那条用户消息前面；它不下发界面，先后不影响渲染。
- **读技能的渠道取决于工具集**：pi 在 `read` 与 `bash` 之间挑第一个**在工具集里**的作为广告渠道
  （`dist/core/system-prompt.js:99-101` 取 `["read","bash"]` 的 `find`）。自定义角色的 `tools` 白名单若只有
  `bash` 没有 `read`，模型会改用 bash 读技能文件——按决策 6 我们不认这条路径，那类角色的命中恒为零。
  本仓库的只读档含 `read`（`server/src/harness/setup/tools/names.ts:19` 的 `READ_ONLY_TOOLS`），现实里成立。
- **索引口径只此一份**：`loader.getSkills()` 与 `commands/list` 的来源判定必须同源。本仓库的约束写在
  `server/src/harness/setup/assets/index.ts` 的文件头注释里——另起一次装载会让「界面列出的」「pi 认的」
  「记录里的」出现三份口径。

## 五、改动清单

### 1. `packages/contracts/src/constants.ts`

在 `PRUNE_RECORD_CUSTOM_TYPE`（:195）一族附近新增；`source` 直接用同文件的 `CommandAssetSource`
（:499，取值表 `COMMAND_ASSET_SOURCES` 在 :491），不需要跨模块引用：

```ts
export const SKILL_RECORD_CUSTOM_TYPE = "ucode.skill";
export const SKILL_RECORD_EVENTS = ["invoke", "hit"] as const;
export type SkillRecordEvent = (typeof SKILL_RECORD_EVENTS)[number];
export type SkillRecord = {
  /** 使用方式：invoke 显式 `/skill:name`，hit 模型按描述自行选用 */
  event: SkillRecordEvent;
  /** 技能名（pi 的 `Skill.name`） */
  name: string;
  /** 技能文件（`SKILL.md`）的绝对路径 */
  file: string;
  /** 来源目录档位，与 `commands/list` 的 `source` 同口径 */
  source: CommandAssetSource;
  /** 读到它的那次工具调用；仅 hit 有 */
  toolCallId?: string;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};
```

块注释按本文件既有风格写清「只为回溯的 `custom` 条目、不进模型上下文、`hit` 下发界面、`invoke` 不下发」。

### 2. `packages/contracts/src/messages/output.ts`

`MessageDTO` 加字段，紧挨 `permissionDecision`（:58）/ `goalRecord`（:62）/ `modeChange`（:64）：

```ts
/** custom 专用：技能命中记录；只有 `SKILL_RECORD_CUSTOM_TYPE` 的 `hit` 条目会带上 */
skillRecord?: SkillRecord;
```

### 3. `server/src/harness/setup/assets/index.ts`

- `sourceOf`（:72）改为导出——与 `commands/list` 的来源判定共用一份实现，避免两处规则漂移；
- 新增 `skillIndexOf(skills: Skill[], paths: CommandAssetPath[]): SkillIndex`：
  `{ list: Array<{ name; file; source }>, byFile: Map<string, …>, byName: Map<string, …> }`。
  路径归一（`~` / 相对 / `realpath`）在这里做一次，命中比对与显式调用判定都查这份索引。

### 4. `server/src/harness/setup/assets/skill-hit.ts`（新文件）

纯函数，只依赖 `node:path` 与索引，与 `expand.ts` 并列（同属「命令与技能」这一域）：

```ts
/** 一次工具调用是否读到了某个技能文件；命中返回那个技能，否则 null */
export const matchSkillHit = (
  toolName: string,
  args: unknown,
  cwd: string,
  index: SkillIndex,
): { name: string; file: string; source: CommandAssetSource } | null => …

/** 一条用户输入是否显式调用了某个技能（pi 的判据：`/skill:name`） */
export const matchSkillInvoke = (
  text: string,
  index: SkillIndex,
): { name: string; file: string; source: CommandAssetSource } | null => …
```

`matchSkillHit`：`toolName !== "read"` 直接返回 `null`；取 `args.path`（非字符串 / 空串返回 `null`），
归一化后查 `byFile`。`matchSkillInvoke`：判据复用既有的 `SKILL_PATTERN`（`server/src/harness/setup/assets/expand.ts:26`，改为导出）
而不是另写一条 `^/skill:(\S+)`——`expandSkillCommand`（同名文件 :116）用的就是它，两处正则漂移会让
「展开的」与「记录的」对不上。取到名字查 `byName`，查不到返回 `null`（pi 也是原样透传）。

### 5. `server/src/harness/setup/session-config.ts`

- `createSessionLoader`（:145）在 `await loader.reload()`（:208）之后返回 `{ loader, skills }`，
  `skills` 由 `loader.getSkills().skills` 经 `skillIndexOf` 得到（路径用本地 `assetPaths.skills`，:155/:184）；
- 内部抽 `assembleSession(input) → { options, skills }`（即现在 `buildSessionOptions` 的主体），
  `buildSessionOptions`（:216，`return` 在 :299）保留为 `(await assembleSession(input)).options` 的薄包装——
  现有测试与脚本不受影响，会话池改用新函数。注意 `assets/index.ts` 里的同名局部量是 `paths`，
  `assetPaths` 只存在于本文件，实施时别把两处当成同一个东西。

### 6. `server/src/core/pool.ts`

- `PooledSession`（:69）加 `skills: SkillIndex`（本会话装配时的那一份）；
- `ensure` 的装配调用（:627，`ensure` 定义在 :576）改用 `assembleSession`，把 `skills` 存进池条目
  （:762 的 `entry` 构造）；
- `session.subscribe`（:687）里、既有 `message_end` / `entry_appended` 提前 `return` **之前**加一段观察：
  - `turn_start` → 清空本轮的命中集合；
  - `tool_execution_start` → `matchSkillHit(...)` 命中且本轮未记过 → 写条目；
- 新增私有方法 `recordSkillHit(manager, sessionId, record)`：`appendCustomEntry(SKILL_RECORD_CUSTOM_TYPE, record)`
  → `events.emitFrame(sessionId, "transcript_reset", { fromEntryId })`；失败只记日志
  （照 :807 的 `recordPermissionDecision`）；
- 新增公开方法 `noteSkillInvoke(sessionId, text)`：内部用池条目的 `skills` 判 `matchSkillInvoke` 并写
  `event: "invoke"` 记录；技能索引与写入都关在池里，调用方不接触资源装载。

### 7. `server/src/services/sessions/run.ts`

`assemblePrompt`（定义 :109）有**两个调用点**，各自在投递之前调一次
`services.pool.noteSkillInvoke(sessionId, prepared.text)`：

- `admitPrompt`（:126）——它的投递分支是 `beginTurn`（:162，兜底分支在 :184）与同一轮内排队的
  `steer` / `followUp`（:178/:179）；
- `admitEdit`（:198，调用 `assemblePrompt` 在 :231）——**原稿漏了这条**：编辑并重发 `/skill:name` 时
  正文同样会被换成 `<skill …>` 块，不记就没有 `invoke` 条目。

`admitGoalRun`（:270）与 `admitPlanApproval`（:291）是合成注入，正文由我们自己写，不记。

### 8. `server/src/harness/pi/serialize.ts`

- `modeRecordOf`（:256）旁加 `skillRecordOf(data: unknown): SkillRecord | null`：逐字段校验
  （`event` 在 `SKILL_RECORD_EVENTS` 里、`name` / `file` / `at` 是字符串、`source` 在
  `COMMAND_ASSET_SOURCES` 里、`toolCallId` 可选字符串），形状不对返回 `null`；
- `custom` 分支（`case "custom":` 在 :344，`MODE_RECORD_CUSTOM_TYPE` 段在 :382-393）在这段之后加一条：
  `event === "hit"` 才下发 `skillRecord`，`invoke` 与非法形状都 `return null`。

### 9. `packages/ui/src/lib/chat-nodes.ts`

- `ToolEntry`（:36）加 `skill?: { name: string }`；
- `indexToolResults`（:232）旁加 `indexSkillHits(items): Map<string, string>`：扫
  `customType === SKILL_RECORD_CUSTOM_TYPE` 且 `skillRecord.toolCallId` 存在的条目，得
  `toolCallId → name`。**必须是预扫**：命中条目排在 assistant 消息之后，主循环走到工具调用时还看不到它；
- `toolEntryOf`（:246）与 `buildAssistantLegs`（:266）加参数透传，命中时给 entry 带上 `skill`；
- 主循环（:396 起）在 `GOAL_RECORD_CUSTOM_TYPE`（:436）那一支附近加一支：`ucode.skill` 条目 `continue`，
  不生成节点（也不能落进 `content` 兜底行）。

### 10. `packages/ui/src/business/tool-call.tsx`

`ToolCall`（:177）在 `InputLabel` 的渲染点（:206，组件定义在 :114）之后插技能标记：`entry.skill` 存在时渲染一个
`rounded-xs bg-muted px-1 text-xs` 的 chip，文案 `t("技能 {{name}}", { name })`，`title` 同文案。
行高仍是 32px，不新增可点区域（路径按钮的预览行为不变）。

### 11. `packages/i18n/src/locales/ui/en.ts`

加 `"技能 {{name}}": "Skill {{name}}"`（放在既有 `技能: "Skills"`（:589）附近）。zh-CN 不登记（中文 key 靠回退），符合
`scripts/verify/checks/i18n.ts` 的「zh-CN 只登记摘要 key」约束。

## 六、测试

- `server/src/harness/setup/assets/__tests__/skill-hit.test.ts`（新）：命中；非 `read` 工具不命中；索引外的
  同名文件不命中；绝对 / 相对 / `~` 三种写法命中同一技能；`args` 非法形状返回 `null`；`matchSkillInvoke`
  的名字不在索引里返回 `null`。
- `server/src/core/__tests__/serialize.test.ts`：`hit` 条目投影出 `skillRecord`；`invoke` 返回 `null`；
  `data` 缺字段 / `event` 非法 / `source` 越界时返回 `null`。
- `packages/ui/src/lib/__tests__/chat-nodes.test.ts`：命中条目不再单独成行；对应的 tool leg 带
  `skill.name`；命中条目没有配对的调用记录（孤儿）时不产生任何行；`invoke` 条目无副作用。
- `server/src/harness/setup/__tests__/session-config.test.ts`：新装配函数返回的技能索引与
  `loadCommandAssets` 的集合一致（守住「不出现第三份口径」）。

## 七、文档与变更日志

- `docs/session-entries.md`：表格加 `ucode.skill` 一行——写入点（会话池的命中观察与 run 的显式调用判定）、
  读取方（`core/serialize` → `MessageDTO.skillRecord`）、进模型上下文「否」、界面「不单独成行，标记挂在
  对应的 `read` 调用上（仅 `hit`）」。`pnpm verify` 的 `session-entries` 会双向核对常量与登记。
- `docs/api-reference.md`：`pnpm api:docs` 重新生成（`MessageDTO` 多了字段）。
- `CHANGELOG.md`：`[未发布]` 的「新增」节加一条（对外接口多了 DTO 字段，属「涉及项目流程状态」）。

## 八、验收

- `pnpm check` 全绿（含 `session-entries` / `api-docs` / `i18n` 三处校验）。
- 手工走查（真实浏览器：`pnpm build` 后开 `http://127.0.0.1:19688`，或 `pnpm dev` 后开 `:5173`）：
  1. 让模型自动用一次技能 → 那一轮「读取 ×n」的聚合行不多占行，展开后读到 `SKILL.md` 的那张卡片
     带「技能 lark-base」标记；
  2. 同一轮里再让它读一次同一个文件 → 不产生第二条记录、标记不重复；
  3. 显式 `/skill:name` → 用户消息的 chip 照旧，消息区**不**新增任何行；
  4. 刷新页面 → 标记仍在（走的是快照投影，不是前端内存态）；
  5. 扫会话 JSONL：`ucode.skill` 条目带 `event` / `name` / `file` / `source`（`hit` 另带 `toolCallId`）。

## 九、暂不做 / 已否决

- **独立的技能细线**（方案初稿）：否决。用户消息的 chip 已经呈现显式调用，`read` 又已在聚合行里，
  再加一条细线是为同一个事实多占一行。
- **在聚合摘要里体现技能**（如「读取 2 · 技能 1」）：不改 `summarizeToolNames`；标记挂到具体卡片上更准，
  摘要只回答「这批调用在干什么」。
- **识别 `read` 之外的一切读取路径**：理由见决策 6。
- **命中统计面板 / 步级聚合**：数据先落盘，聚合与展示并入用量统计那次重构（见 `TODO.md`）。
- **老会话回填**：不做（`AGENTS.md` 的兼容性约定）。
