# TODO

只列**未完成**的条目，做完即删。历史看 [`CHANGELOG.md`](./CHANGELOG.md)，逐项落位看 [`plans/`](./plans/)。

---

## 待定 · 内置供应商的「拉取模型列表」入口

设置页的「拉取模型列表」只出现在自定义供应商上：内置供应商的模型清单来自 pi 内置目录（只读、随升级更新），
要拉取就得先把结果落成 `models` 覆盖内置清单——属于另一件事，等确认要不要做。

---

## 待定 · 模型无视系统提示词时的会话级退化

**现象**：部分代理 / 模型会整条丢掉 `system`（与 `developer`）角色的消息（实测 `local/ucas-max`：两种角色都无视，
指令内联进 user 才生效）。pi 把所有指令都放在这一处 system，且**没有**「system 并入 user」的兼容开关——
`compat` 只有 `supportsDeveloperRole` / `supportsMidConvoSystemMessages`，后者的降级也只是合并回首条 system。

后果：plan 不主动调 `present_plan`、AGENTS.md 与注释 / 验证约定不生效、技能自动命中失效
（`/skill:name` 显式调用与工具 description 不受影响）、`codemode` / `deferred` 型 MCP 服务器不可见、
记忆索引与外部内容边界声明失效。**硬机制不受影响**：只读模式的工具白名单、权限规则、路径校验照旧，不会越权。
后台辅助调用（标题 / 记忆回顾 / goal 校验）已把指令内联进 user 消息（见 `harness/utils/instruction`），不受此影响。

**待办**：给模型加一次「是否遵守 system」的探测（挂在设置页连通性测试或拉取模型上），把结论落到模型配置并在
会话里提示；不做会话级兜底——每轮追加约束会让上下文膨胀、提示缓存失效，且治不了技能清单与 MCP。

---

## 待定 · goal 校验输出无法解析时的止损

**现象**：校验解析不出 JSON 时按「未达成」处理，而「无进展」计数看的是主会话的 assistant 活动、不是校验结论
（`harness/features/goal/verify.ts`）——主会话一直在干活时，校验每轮都判未达成，目标会持续续跑、白烧 token。

**待办**：连续 N 次解析失败即暂停目标并下发原因；N 与文案待定。

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

---

## 需求 · logo 重新设计

**现象**：现有 logo 需要重新设计。

**待办**：待确认（新设计方向、是否同步替换 `packages/brand` 的品牌与图标资产）。

---

## 需求 · composer 编辑器支持有序 / 无序列表

**现象**：composer 编辑器目前不支持有序与无序列表。

**待办**：待确认（支持范围内是否需要自动续行、缩进与粘贴解析）。

---

## BUG · 桌面端通知异常

**现象**：桌面端通知有问题，具体表现未描述。

**待办**：待确认（先确认触发场景与期望表现）。

---

## 需求 · 背景改毛玻璃与分层

**现象**：最底层背景希望换成毛玻璃；桌面端背景要求透明，web 端的 body 要加一张背景图。

**待办**：待确认（毛玻璃的作用层、桌面端透明与背景图的取值方式）。

---

## 需求 · 桌面端去掉 logo 显示

**现象**：桌面端界面上不希望显示 logo。

**待办**：待确认（去掉的位置范围）。

---

## 需求 · 对话区 header 改成按状态切换的背景色动画

**现象**：对话区 header 现有「生成中」的 loading 态要去掉并重新设计；改为 header 按当前状态显示不同的背景色动画（轻度淡色），
生成中、表单、权限三种状态各用一种背景色动画态。

**待办**：待确认（三种状态的色值取值、动画形式与状态优先级/叠加时的表现）。

---

## 需求 · 侧栏与工作台的树默认宽度改用固定值

**现象**：侧栏与工作台里的树，默认宽度目前用百分比；希望改成固定值。

**待办**：待确认（具体固定宽度取值与窗口太窄时的降级行为）。

---

## 需求 · 内容区 header 加导出 / 复制会话入口

**现象**：内容区 header 缺少会话导出相关的入口。

**待办**：在 header 加按钮，点击后可做其中一项：复制当前会话 JSONL 的路径、直接复制 JSONL 内容到剪贴板、导出对话。
待确认（三个动作做成一个菜单还是只取一种、导出格式与范围）。

---

## 需求 · 工作台按项目记住是否显示

**现象**：工作台的显示状态需要按项目区分并记住。

**待办**：待确认（项目如何去重与切换时的行为、状态存本地还是服务端）。
