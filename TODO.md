# TODO

只列**未完成**的条目，做完即删。历史看 [`CHANGELOG.md`](./CHANGELOG.md)，逐项落位看 [`plans/`](./plans/)。

每条写清三件事：现象、落点（文件:行）、验收。口径或素材没定的放「需要你拍板 / 给素材」；
本轮明确不做、留着记录与依据的放「暂缓」。写完的条目整条删掉，不留「已完成」记录——那属于 CHANGELOG。

当前只有一条「已定稿、可直接开工」的条目（浏览器工具集），其余暂缓项都在等明确指令。
web 端背景图已定口径「用纯色、不做图」（见 `DESIGN.md`「分层」），不再单列条目。

---

## 已定稿、可直接开工

### 浏览器工具集（含 screencast 面板）

方案见 [`plans/browser-tools.md`](./plans/browser-tools.md)（**定稿，未实施**）。口径已定：内置功能形态
（`harness/features/browser` + 内联扩展工厂，不做插件包）、服务进程内 Playwright headless、从零实现、
可视化同步做源文档的档位 2（CDP screencast → 新 SSE 帧端点 → 工作台面板）；浏览器身份可配（默认隔离实例，
可选 attach 用户自带的调试端点），隔离数据按命名 profile 长期保留并在设置页管理。旧的桌面端
`WebContentsView` 方案已废弃删除。实施步骤与验收口径见该文第十、十一章。

---

## 需要你拍板

### 中继服务

方案见 [`plans/relay.md`](./plans/relay.md)，前置的服务化与鉴权已落地；插件平台的内置资产云同步也挂在
这条上（接口约定已写进该文）。等明确指令再启动。

---

## 暂缓（等明确指令再启动）

### 大对话消息列表窗口化（L）——本轮明确不做

**现象**：`POST /api/v1/messages/list` 是全量返回——契约入参只有 `sessionId`
（`packages/contracts/src/messages/input.ts:8`）。实测 5.31 MB 的 JSONL 一次返回 3.84 MB / 1482 条消息。

**必须保住的不变量**（改的时候不能破）：

1. `seq` 与投影在同一同步块内取、中间不能插 await / microtask（`routes/messages/index.ts:53-56`）；
2. `transcriptStates` 必须沿完整 `getBranch()` 推进（`harness/pi/serialize.ts:166-171`），
   窗口切片只能作用于下发集合——否则压缩点之后的档位与 provider 全丢；
3. 最新压缩条目的判定（`serialize.ts:507-511`）必须对完整 entries 做；
4. custom 白名单条目（审批 / 压缩记录 / 目标 / 技能 hit / 重试 / 忽略标记 / `custom_message` 两类）不得丢；
5. 压缩的「分隔行」在 `buildContextEntries()` 首位、「记录」在压缩点之后——尾部窗口只含记录时会渲染出
   「已压缩但没有摘要」的行，摘要是被替代历史的唯一凭据，要单独给字段或强制窗口覆盖压缩点；
6. 客户端轮语义（页脚耗时、计划表单判定、目标归轮）要求窗口上沿不切在一轮中间。

**开工前要定的三件事**：游标 vs offset（`docs/api.md:120-122` 的房规是 `limit` / `offset`，
但历史会不断追加、offset 会漂，推荐条目 id 游标）；窗口是否按轮对齐；长工具输出是否在列表投影里截断
（截断要新增「按条目取原文」的接口，且必须**头截断**保住结果首行的 `task_id:`，见
`packages/ui/src/business/chat/tool-view.ts:150`；`write` / `edit` 的 diff 需要完整 args，见同文件 `:139`）。

**注意**：窗口化省的是传输 / 解析 / store 归并 / 首屏渲染，**不省服务端成本**——`/list` 仍要
`SessionManager.open` + `buildContextEntries()` + `getBranch()` 走完整个 JSONL。

### 内置供应商的「拉取模型列表」入口——本轮明确不做

**现状**：拉取入口只出现在自定义供应商上（`business/settings/provider-detail.tsx:100-112` 的 builtin 分支
只渲染 `BuiltinFields`）。后端覆盖链其实是通的：写了 `provider.models` 即**整体替换**内置清单、
`harness/pi/runtime.ts:84-86` 会用内置端点补 `baseUrl`。缺的是：

- 契约 `baseUrl` 必填要放行成「`providerId` 与 `baseUrl` 二选一」（`packages/contracts/src/config/input.ts:182-190`）；
- `routes/config/index.ts:98-121` 按 `providerId` 从 catalog 取端点与 api；
- 界面入口 + **内置供应商的模型编辑面**（现在只能填 apiKey 与「恢复默认」，拉了也没处落）。

**前置限制**：端点为 null / 仅 OAuth 的内置供应商拿不到 `baseUrl`；非 `openai-completions` 的拉取必然 400
（按钮要禁用或说明）。要开就得连编辑面一起开。

### 内核瘦身：模式不再写死在核心里

原先记的位置有两处已过期，重新盘过一遍（拍板后按新清单做）：

- **已失效**：`core/pool.ts` 的 `bindExtensions` 现在对所有会话无条件调用（`:790`），扩展门控已改成
  能力谓词（`harness/setup/session-config.ts:203-208`）；`profiles.ts` 的行号是 75 不是 72。
- **真正要改的服务端 7 处**：记忆工具（`session-config.ts:341-344` + `prompt/index.ts:39`，顺带修
  「plan / ask 讲了记忆却不给工具」的不一致，`prompt/index.ts:69,84`）、目标（`routes/goals/index.ts:57`、
  `harness/features/goal/index.ts:180`、`routes/sessions/index.ts:233`，另加已有的谓词
  `session-config.ts:285-288`）、待确认计划（`core/pool.ts:1115` 的 slug 前置门）、清单收敛
  （`routes/agents/index.ts:36,42`、`agents/custom.ts:257` 改用 `PRIMARY_PROFILES` 的键）。
- **界面 3 处**：`presets/workspace-layout.tsx:370,376`（后者把批准后的模式硬切到 `"build"`，
  自定义 plan 类角色会被掰走）、`business/mode-picker.tsx:14,53` 改吃 `agents/list`（该接口目前零调用点）、
  `chat-panel.tsx:423` 的硬编码 `"build"`。
- **要新增的声明位**（落在 `AgentCapability`，并透出到 `AgentView`，否则界面只能按 slug 猜）：
  `planPending` / `goal` / `memory` / `approveTo`。
- **唯一的高风险点**：`core/pool.ts:1115` 在 `statusOf()` 里被列表每行调用，换成注册表查询会把 IO 加进热路径
  ——声明必须缓存进 `PooledSession`。

### 插件平台收尾项

原 `plans/plugins.md` 一～九章主体已落地，随方案文档删除留下这几处没做：

- **执行类组件的总开关**：一个开关停掉全部 hooks / `extensions/` / `bin`（资源型组件照常加载）。
  现在只有逐插件与逐来源门控，没有全局开关。落点 `services/plugins/index.ts` 的 `trustedAssets`。
- **`userConfig` 的 `sensitive`**：现在与普通值一样明文落 `plugins.json`（0600），只在视图层不回显
  （`harness/plugins/view.ts`）；方案要求走系统凭据库、取不到就拒绝保存。
- **npm 来源的 integrity**：npm 分支不记 `integrity`（`services/plugins/sources`），`updates.ts` 只比
  `npm view … version`；方案要求按 registry 的 integrity 校验。
- **清单 `ui` 键（ZCode 的 `ui.surfaces`）识别保留**：现在按未知字段剥离，方案要求识别、保留并出诊断。
  落点 `constants/plugins.ts` 的 `PLUGIN_IGNORED_MANIFEST_KEYS`。
- **插件测试夹具与冒烟**：没有 `harness/plugins/__tests__/fixtures/` 下的真实 Claude / ZCode 插件形状存档
  （现在都在临时目录里内联构造），也没有 `pnpm smoke` 的「启用含 skill 的插件后模型可调用」用例。

### 内置技能的 `.md` 真身

`server/src/harness/plugins/builtin/skills/` 曾是空目录（已删），技能真身是 TS 常量
（`builtin/skills.ts`）。改成 `.md` 要同时解决 esbuild text loader、开发 / 测试链路（tsx）加载 `.md`、
以及正文里品牌派生值的模板替换三件事，收益只是编辑时有 Markdown 高亮——不划算，暂不做。

### 内置 TODO 工具 / wiki

暂无实现计划。
