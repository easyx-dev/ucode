# TODO

只列**未完成**的条目，做完即删。历史看 [`CHANGELOG.md`](./CHANGELOG.md)，逐项落位看 [`plans/`](./plans/)。

---

## 待定 · 内置供应商的「拉取模型列表」入口

设置页的「拉取模型列表」只出现在自定义供应商上：内置供应商的模型清单来自 pi 内置目录（只读、随升级更新），
要拉取就得先把结果落成 `models` 覆盖内置清单——属于另一件事，等确认要不要做。

---

## 暂缓（等明确指令再启动）

- **插件机制**：方案见 [`plans/plugins.md`](./plans/plugins.md)。
- **中继服务**：方案见 [`plans/relay.md`](./plans/relay.md)，前置的服务化与鉴权已落地。
- **内置 TODO 工具 / wiki**：暂无实现计划。

---

## 需求 · 步级耗时统计的聚合与展示

**现象**：每步的耗时已经把三段拆开记进会话（`ucode.step` 条目，见 `server/src/harness/telemetry`），
但还没有聚合出口与展示——用量面板看不到「每轮步数 / 平均每步耗时 / 首 token 占比 / 工具耗时占比」，
于是「压缩阈值定多少、要不要降 thinking 档、并发子智能体要不要错峰」这些判断仍要手工扫会话文件。

**待办**：在 `harness/usage` 的派生里加上步级聚合，落到 `packages/contracts/src/stats/output.ts`
并在用量面板展示。**使用统计整体会另行重构**，这条可以并入那次重构，或等重构后按新结构补——
数据已经在按步落盘，缺的只是聚合与呈现。

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

**待确认**：插件形态（是否走现有扩展机制 / 独立包）、是否给「需要登录态的流程」开口子（以及怎么隔离）、
动作集按上面到哪一档为止。

---

## 界面收敛 · 侧栏

本批四条的决策已定，直接照此实现。

### 项目分组的排序随活动跳动

**现象**：分组顺序取组内最近活动降序，于是在 A 里发一条 A 就排最前，在 B 里发一条 B 又排最前，来回跳。

**待办**：改为按**项目首次创建时间**（组内最早会话的 `createdAt`）降序——新项目排最前，之后发消息不再改顺序。
落位 `packages/ui/src/lib/session-groups.ts` 的 `groupSessions`；组内会话仍按 `updatedAt` 降序，不动。

### 与对话区之间的空白

**现象**：侧栏底色与页面底色相同，栏与栏之间靠「列表右内边距 8px + 分隔条命中区 12px」= 20px 的空白分层，
看起来全落在侧栏里（左侧只有 8px）。

**待办**：侧栏侧的分隔条**叠到侧栏上**（命中区盖住侧栏右边缘的空白，不再额外占宽），
侧栏内容与对话区卡片之间只剩单边 8px。`DESIGN.md`「分栏」一节里「侧栏侧 12px」那条同步改口径。

### 会话行的状态图标与项目图标不一致

**现象**：会话行左侧的状态图标（生成中 / 待回答 / 待计划）是 `size-3.5` 且居中在一段 24px 的槽位里，
与父级项目行的文件夹图标（`size-4`、紧贴 `px-2`）既不同大也不对齐。

**待办**：状态图标统一 `size-4` 并与文件夹图标左对齐；置顶针与未读点可并存的槽位宽度不变，
两侧标题的起始位置仍保持一致。落位 `business/session-list-item.tsx`。

### 对话区头部

**现象**：「新建任务」按钮（`chat-header.tsx` 的 `CirclePlus`）没有实际价值；标题只有 `truncate`，
既看不到全名也不能就地改名。

**待办**：删掉该按钮（连同 `ChatPanel` / `WorkspaceLayout` 一路传下来的 `onNewTask`，别留死参数）；
标题溢出时悬停给 tooltip 显示全名，双击就地改名（复用 `business/rename-session-dialog.tsx`）。

---

## 界面收敛 · 输入区

### 支持撤销与前进

**现象**：编辑器只装了文档结构节点与两个 mention，没有历史扩展，`⌘Z` / `⌘⇧Z` 不生效。

**待办**：给 `business/composer/editor.tsx` 加历史扩展，`⌘Z` 撤销、`⌘⇧Z`（与 `⌘Y`）前进；
mention 节点与附件条走同一份历史。

### 去掉输入区上方的边框

**现象**：`composer.tsx` 外层带 `border-t border-border`，在浮起的输入卡上方多出一条没用的横线。

**待办**：去掉这条 `border-t`；同时确认 `ChatPanel` 里子会话提示行、目标栏的边框不被连带改掉。

---

## 界面收敛 · 消息区

### `@` 引用、技能与命令渲染成 chip

**现象**：用户消息里的 `@路径` 只是普通文本，点不动；技能已有 chip；提示词命令（如 `/review`）被服务端
展开成整段模板正文后当用户原文整段贴出来。

**待办**（三件一起做）：

1. `@路径` 标记渲染成可点 chip，点击即在右侧工作台打开该文件预览（走 `useWorkbench().openPreview`，
   相对路径按会话 cwd 拼绝对路径）。
2. 命令按技能同一套做：服务端不再依赖 pi 的展开，自己把 `/name` 展开成 `<command name="…">…</command>`
   边界块（与 `<skill>` / `<context>` 同形，界面整体剥掉、只留 chip），`parseUserMessage` 增加命令的还原。
3. 三者的 chip 样式统一（`business/message-item.tsx` 的用户消息分支）。

**为什么不能只在客户端做**：pi 的 `expandPromptTemplate` 把整条消息替换成模板正文并落进会话文件，
客户端再也认不出这是一条命令——必须在投递前自己展开并保留块边界（落位 `server/src/core/run.ts` 的 `buildPrompt`，
模板从已装配会话的 `promptTemplates` 取）。

### 用户消息过长时折叠

**现象**：用户贴一大段日志时，用户消息块能把整屏占满。

**待办**：用户消息块设一个最大高度，超出时折叠（底部渐隐）并给「展开 / 收起」入口；
落位 `business/message-item.tsx` 的用户消息分支，`DESIGN.md`「消息区」的用户消息一行同步。

---

## 界面收敛 · 工作台与全局

### 工作台尺寸与展开状态

**现象**：展开状态不记忆（刷新即收起，侧栏的收起状态是记的）；宽度上限 720 偏小，
而对话区不设下限、可以被拖到很窄。

**待办**：展开状态按栏持久化（与侧栏同法，`localStorage`，键加品牌前缀）；工作台上限 720 → 1200；
给对话区设最小宽度 400px。`DESIGN.md`「分栏」表同步。

### 全局滚动条样式

**现象**：滚动条走系统默认，深浅色下都偏粗、与设计 token 不搭。

**待办**：在 `packages/ui/src/styles/theme.css` 的 base 层统一滚动条样式：细、圆头、颜色取语义 token、
跟随 `.dark`（`scrollbar-width` / `scrollbar-color` + `::-webkit-scrollbar-*` 两条路都要给）；
`DESIGN.md` 补一条落位说明。

---

## 需求 · 内置 `review` 命令

**现象**：`/review` 现在只是本仓库的 `.agents/commands/review.md`（经 `.ucode/prompts` 软链被读到），
换个工作目录就没有这条命令。

**待办**：做成内置提示词命令，正文即 `.agents/commands/review.md` 的内容，**优先级最低**：
项目 `.ucode/prompts` 与全局 `~/.ucode/prompts` 的同名文件可覆盖。落位 `harness/assets`：
用 resourceLoader 的 `promptsOverride` 追加（同名已被磁盘上的占用则跳过，`COMMAND_ASSET_SOURCES` 补 `builtin`），
`loadCommandAssets` 的「无目录即空集」早退要一并放宽，`docs/api.md` / 契约注释同步。

---
