# TODO

只列**未完成**的条目，做完即删。历史看 [`CHANGELOG.md`](./CHANGELOG.md)，逐项落位看 [`plans/`](./plans/)。

---

## 待定 · 内置供应商的「拉取模型列表」入口

设置页的「拉取模型列表」只出现在自定义供应商上：内置供应商的模型清单来自 pi 内置目录（只读、随升级更新），
要拉取就得先把结果落成 `models` 覆盖内置清单——属于另一件事，等确认要不要做。

---

## 暂缓（等明确指令再启动）

- **中继服务**：方案见 [`plans/relay.md`](./plans/relay.md)，前置的服务化与鉴权已落地；
  插件平台的内置资产云同步也挂在这条上（接口约定已写进该文）。
- **内置 TODO 工具 / wiki**：暂无实现计划。

---

## 需求 · 插件平台（架构定稿，待实施）

**目标**（本轮收窄）：插件是**资源与受信任代码的打包单位**——把 skills / commands / agents / hooks /
MCP / bin / 代码模块打包成可启停、可分发、可升级的单元，兼容 Claude Code / ZCode 插件的目录与清单。
出口开箱两个市场（自有官方市场 + `claude-plugins-official`）；**执行类组件按来源门控**：
第三方市场的 hooks / bin / 扩展只解析出诊断、不注入运行时（对齐 ZCode 的兼容策略）。
**不再包括**：插件定义主模式、插件贡献界面、插件接会话钩子、能力授权与授权表——逐条理由见方案第十一章。

**方案**：[`plans/plugins.md`](./plans/plugins.md)（单文档：定位、包格式与兼容、装载与热重载、信任、
市场与版本、内置资产、落位与验收）。

**待办要点**：按该文第九章实施（合同 → 资源接入 → 执行类组件 → 设置页与内置资产 → 市场 → 热重载收尾）；
动手前先看该文 10.1「要先改的内核代码」。

---

## 需求 · 步级耗时统计的聚合与展示

**现象**：每步的耗时已经把三段拆开记进会话（`ucode.step` 条目，见 `server/src/harness/features/telemetry`），
但还没有聚合出口与展示——用量面板看不到「每轮步数 / 平均每步耗时 / 首 token 占比 / 工具耗时占比」，
于是「压缩阈值定多少、要不要降 thinking 档、并发子智能体要不要错峰」这些判断仍要手工扫会话文件。

**待办**：在 `harness/features/usage` 的派生里加上步级聚合，落到 `packages/contracts/src/stats/output.ts`
并在用量面板展示。**使用统计整体会另行重构**，这条可以并入那次重构，或等重构后按新结构补——
数据已经在按步落盘，缺的只是聚合与呈现。

**方案**：见 [`plans/usage-stats-refactor.md`](./plans/usage-stats-refactor.md)——定稿的走向是**先重构再聚合**：
把 `UsageService` 的三职责（解析 / 聚合 / 运行期状态）拆开，`ucode.step` 接进解析层，并给步级记录补
`userTurn` / `provider` / `model` / `stopReason` 四个字段、修正 `ttftMs` 的口径；**缓存命中率**一并做
（数据早已具备，缺的只是派生与展示）。

---

## 需求 · 浏览器 / 桌面端操作能力改成插件

**现象**：曾内置过一个 `browser` 工具（`harness/browser`，基于 `playwright-core`，含浏览器与桌面端两个目标），
**现已整体撤掉**——能力面太窄（只有 open / click / fill / press / wait / eval / expect / screenshot），
真实界面验证里常用的悬停、下拉、勾选、滚动、上传、前进后退、元素清单都缺，继续加只会让「内置工具」越滚越大。
决定改为**以插件形式集成**：一次把「agent 操作浏览器」与「agent 操作桌面端」作为同一件事做进来。

**撤掉时删掉的东西**（重做时按需取回，别重复踩）：`harness/browser/*`、`playwright-core` 依赖、
`APP_BROWSER_PATH` / `APP_DESKTOP_PATH`、`browser` 的工具名与权限规则、提示词里的浏览器分节与 `<page>` 边界。
**保留**：桌面端 `resolveHomeDir` 的 `~` 展开修复（那是独立的现存 bug）。

**插件要覆盖的能力**（对照 `agent-browser` 0.31.1 的命令面梳理，按优先级）：

1. **动作**：现有 8 个 + `snapshot`（`page.ariaSnapshot()`，给角色 / 名称而不是易变的 `@eN` 引用）、
   结构化 `expect`（`{ selector, state: "visible"|"hidden"|"text"|"value"|"count"|"checked", value? }`，
   失败要说清「期望 vs 实际」）、`select`、`check` / `uncheck`、`hover`、`reload`、`scroll`、`upload`、
   `back` / `forward`；第二梯队 `type`（逐字符键入）、`screenshot` 的 `element` / `clip`。
   `drag` 必须先实测：我们的分栏是 pointer-events 实现（shadcn Resizable），`locator.dragTo` 未必生效。
   注意 `select` / `check` 的描述要写明 shadcn / Radix 的下拉与开关是 button + listbox / `role=switch`，
   对它们必须两次 click。
2. **桌面端同样是一等目标**（不是浏览器的替代品）：应用主进程会从 `service.json` 取 `serviceToken` 注入渲染层，
   驱动它等于**带真实凭证、动真实数据**；dev 场景的启动要点是用 `DESKTOP_RENDERER_URL` 指向已构建的渲染层
   （否则非打包启动只认 dev server）。Playwright 的 `_electron` 是实验性 API 且与 Electron 版本绑定。
3. **安全边界必须原样继承**（这几条是踩过点定的，重做时别丢）：只驱动系统已装的浏览器（不下载）、
   **不持久化 profile**（每次跑在临时 context 里，继承不到也写不进用户的登录态）、
   调试端口只连回环且不引入任何放宽安全的开关、动作与 `bash` 同权限档且只读模式不给、
   页面内容按外部不可信内容包裹（`<page>` 边界已在撤掉时一并移除，重做时补回）。
   与 `agent-browser` 的关键差别就在这里：它支持 `--profile Default` 复用真实登录态、`--auto-connect`
   挂上正在跑的 Chrome——能力更强，但那是把用户的全部登录态交给 agent，需另行拍板。

**待确认**：做到哪一档为止（动作集、是否给「需要登录态的流程」开口子以及怎么隔离）。

**与前一条的关系**：这道题**不能做成第三方插件**——插件平台已收窄为「资源打包 + 代码型扩展」，
没有界面贡献、没有会话级 API（见 `plans/plugins.md` 第十一章）；而它既要一套「服务端挂起 + 客户端执行」
的桥（插件宿主跑在 server 进程内，**物理上够不到 Electron 与浏览器**），又要截图 / 操作面板这类界面。
所以它要么作为**内置能力**（含那套桥）做，要么等「插件改界面」这件事另开一版（届时照 Claude 的 mods
模型：代码型事件 + 重绘 + 画不出来就降级，见 `plans/plugins.md` 第十一章末行）。方案见
[`plans/builtin-browser.md`](./plans/builtin-browser.md)。

---

## 需求 · 内核瘦身：模式不再写死在核心里

**现象**：`mode === "build"` / `mode !== "plan"` 这类分支散在内核与路由里（记忆工具注册、
`bindExtensions`、目标续跑、`isPlanPending`、设置目标的模式检查等），`SESSION_MODES` 同时被
角色注册表、路由与界面当成「模式清单」的事实源。原本打算靠「把 plan / goal 迁成插件」一并解决，
但插件平台已收窄（不再接受插件定义模式），所以这是**内核内部重构**，单独跟进。

**待办**：把模式清单收敛到注册表一处（`hasPrimaryMode` 已是入口），把内核里按 slug 判断的分支换成
能力 / 声明（如「本模式会不会有待确认的计划」由角色声明给出）。涉及的位置：
`harness/setup/session-config.ts:286-288`（记忆工具）、`harness/setup/prompt/index.ts:39`（提示词里的记忆工具）、
`core/pool.ts:726`（`bindExtensions`）、`core/pool.ts:1044-1050`（`isPlanPending`）、
`routes/sessions/index.ts:230-236`（切走 build 即暂停目标）、`routes/goals/index.ts:57`、
`harness/features/goal/index.ts:180`、`harness/setup/agents/profiles.ts:72`、
`routes/agents/index.ts:36-42`、`harness/setup/agents/custom.ts:251,265`，界面侧
`packages/ui/src/business/mode-picker.tsx:14,27,53` 与 `packages/ui/src/lib/mode.ts:5-30`。
动手前重新盘一遍，行号会漂。

---

## 需求 · 会话活动悬浮面板（子智能体 / 目标 / 后台服务）

**现象**：三块「跑着但不在视野里」的状态散在界面上——进行中的子智能体只内联在默认收起的工具卡里
（不点开完全看不见）、目标进度要展开「目标轮次」才看得到、`bash` 工具起的后台服务则**完全没有记录**
（`server/src/harness/features/shell/` 只透传 `BashOperations.exec`，拿不到 pid、端口与进程关系）。

**方案**：[`plans/activity-panel.md`](./plans/activity-panel.md)（方案定稿，待实施）。

**待办要点**：按该文第六节实施——服务端新增「后台服务」运行态（端口线索 + 前后探活对比判归属，
`service_update` 全量帧 + `messages/list` 快照下发）、SDK 归并、对话区右下角悬浮活动面板
（子智能体 / 目标 / 后台服务三段只读）、子智能体进度从工具卡内联移入面板并留一个带定位的短入口。

**明确不做**（见该文第十节）：追踪 pid 与「停止服务」、`lsof` 全机端口 diff、落 `ucode.service` 条目、
跨会话聚合、执行期定时探测。

---

## 需求 · 大对话的消息列表改成窗口化加载

**现象**：`POST /api/v1/messages/list` 是**全量**返回——契约入参只有 `sessionId`，服务端把整段历史投影成
`MessageDTO[]` 一次下发。实测会话 `c03f8645`（JSONL 5.31 MB、1466 条 message 条目）一次返回
**3.84 MB / 1482 条消息**，服务端耗时约 40 ms；体积大头是 assistant 正文与 thinking（2.32 MB）、
工具结果（1.48 MB），单条最大 ~64 KB（`read` 的一次长输出原始 121 KB）。会话越长这份响应越大
（工作区里已有 20 MB 的 JSONL）。界面只虚拟化了 DOM（`packages/ui/src/business/message-list.tsx` 用
`@tanstack/react-virtual`），传输、解析与 store 归并仍是全量。

**待办要点**（先定口径再动手）：

- 契约：`packages/contracts/src/messages/` 的 `messageListInputSchema` 加游标与条数，
  `MessageListResponse` 补「是否还有更早」与游标；
- server：`routes/messages/index.ts` + `harness/pi/serialize.ts` 的投影按窗口切片。
  两个既有约束不能破——`seq` 与投影必须在同一同步块内取（客户端按 seq 切实时帧），
  `transcriptStates` 必须沿完整路径推进（否则压缩点之后丢档位）；
- SDK / UI：滚动到顶加载更早，`packages/sdk` 的 messages store 做归并。

**注意**：不能简单截断——权限审批、压缩记录、目标记录这类 `custom` 条目是界面回放用的，窗口化时要保留；
另外要定长工具输出（单条几十 KB 的 `read` / `webfetch`）是否在列表投影里截断、展开时再取。

---

## 需求 · 移动端不显示滚动条

**现象**：移动端界面上仍会显示滚动条，观感与触屏操作不符。

**待办**：待确认——需要定范围（消息区 / 工作台面板 / 全局）与实现方式（隐藏滚动条但保留滚动能力，或改成触屏习惯的提示）。
