# 组件规范

前端组件的组织方式与约束。视觉取值（颜色 / 状态层 / 排版 / 尺寸与圆角 / 阴影与层级 / 动效）见 [`DESIGN.md`](../DESIGN.md)，
界面分块见 [`design-surfaces.md`](./design-surfaces.md)，本文只管组件的结构与行为。

**本文声明规范并举例，不列举组件清单**——清单会随实现漂移，需要靠人维护；规范应当稳定到不需要维护。

## 组件来源与维护

组件与 hooks 位于 `packages/ui`（`@ucode/ui`），web 与桌面端共用。基础组件
`packages/ui/src/base/**` 里的 shadcn 产物由 shadcn CLI 生成（配置见 `packages/ui/components.json`），
但**只生成一次**：之后与其它代码一样由我们维护，同等适用本仓库的格式化、命名、颜色 token 与行数规则。

- 新增基础组件用 `npx shadcn@latest add <name>` 生成，生成完即视为项目代码，按本规范整理
- 本包 tsconfig 没配 `@/*` 的 paths，CLI 会把 aliases 当字面路径，产物落在 `packages/ui/@/base/<name>.tsx`：
  先生成、再挪到 `src/base/<name>.tsx`
- 生成后要把 `@/` 导入改成包内相对路径、`@/utils` 改成从 `cn` 包导入，图标占位组件（`IconPlaceholder`）
  换成 `lucide-react`，去掉本项目没定义的 style 专用类（如 `cn-menu-*` / `cn-rtl-flip`），`"use client"` 也去掉
- CLI 写入过就会一直报 “Skipped 1 file”（包括文件已删时），这时用 `npx shadcn@latest view <name>` 取源码手写
- 对已经改过的组件再跑 CLI 会覆盖我们的改动，需要手工合并
- CLI 生成的那批不要求写文件级注释（都是对 Radix 的薄封装）；`base/` 下自研的原语照常要写

## 目录与命名

```
packages/ui/src/
  base/               # 原语：无业务语义、只吃 props（shadcn 产物 + 自研原语）
  utils/              # 跨域通用方法与类型门面（无 React）
  hooks/              # 跨域复用的 React 绑定 + 无域语义的通用 hook
    store/            # SDK store 的订阅与派生（薄绑定不论消费者多少都在这层）
  business/<域>/      # 业务组件：一级一律是域文件夹，域内自含组件 + 私有逻辑 + 私有 hook + 用例
    chat/             # 对话区骨架（面板、头部、空态、头部动作、会话状态条）
      message/        # 消息流：条目投影（nodes / rows / plan / goal-turns）、行渲染、目录条
      tool/           # 工具与子智能体在消息流里的呈现（聚合行、工具卡、改动卡片、处理中指示、改动的 patch 文本）
      activity/       # 运行态浮层（子智能体 / 目标 / 后台服务）与子会话小窗
      decision/       # 决策区：权限 / 问答 / 计划，盖在输入区上
    composer/         # 输入区
      editor/         # Tiptap 编辑器内部：扩展、建议、`@` 候选、附件 chip
      picker/         # 四个 picker 与共用外观、它们的文案映射
      document/       # 文档 ↔ 提交载荷、草稿落盘、正文标记编解码
      project/        # 项目（工作目录）：取值、选择器、行、重命名弹层
    session/          # 侧栏、会话列表与项目分组
    goal/             # 目标栏与目标轮次线
    markdown/         # 正文渲染：入口 + diff
      code/ mermaid/ table/   # 代码高亮 / mermaid / 表格三块（各自含引擎、hook 与弹层）
    attachment/ dialog/ notify/
    shell/            # 应用外壳级：登录页、主题 Provider、错误提示、命令面板
    settings/         # 设置面板
      pages/          # 单个设置分页（外观、默认值、记忆、联网）与它们的 hook
      service/        # 远程访问与中继：两者合成的弹窗与各自面板（侧栏页脚入口）
      models/ plugins/ mcp/ assets/   # 模型与供应商 / 插件 / MCP / 角色·技能·命令三块
    workbench/        # 工作台：面板骨架 + git/（变更与 diff）+ file/（文件与编辑器）+ terminal/（终端）+ design/（设计画布、图层与属性浮窗）
    usage/            # 用量统计
  provider/           # UiProvider：注入应用层创建好的 client；外观偏好的事实源也在这里
  presets/workspace/  # 预置组合：入口 + 按关注点拆的 hook（外壳几何 / 工作台 / 会话动作 / 目标与计划 / 内置命令 / 快捷键）
  styles/theme.css    # 设计 token 与基础样式
  assets/             # 包内随包资源（提示音等）
  types.ts            # 契约与 SDK 类型的包内出口
```

- 一个文件一个主组件，文件名 kebab-case，与组件名对应（`xxx-card.tsx` → `XxxCard`）
- `business/` 一级一律是目录，不直接放 `.tsx`；域内文件超过十来个、或出现第二层职责时再开子目录
  （`chat/` 就是这么分的：根上是对话区骨架，`message/` / `tool/` / `activity/` / `decision/` 各管一块）
- 文件名与目录名同名时不重复语义（`settings/settings-row.tsx`，不是 `settings/settings-settings-row.tsx`）
- 子组件只服务单个父组件时留在父组件文件内，不单独开文件
- 用例放被测模块同级的 `__tests__/`，命名 `<模块>.test.ts`

**落位判据**（新增一个模块时按这个选位置，别按「放哪顺手」）：

| 情况 | 落位 |
| --- | --- |
| 只被一个域使用 | 该域目录内（逻辑 `.ts`、hook、用例都跟着走） |
| 只做「SDK store ↔ React」的薄绑定（`useStore(client.x)` + 载入 / 动作转发） | `hooks/store/`，不论有几个消费者 |
| 无域语义的通用 hook（视口观察、设计 token 取值、一次性取数） | `hooks/` |
| 被 ≥2 个域使用、无 React | `utils/` |
| 被 ≥2 个域使用、是 React 绑定 | `hooks/` |
| 被 ≥2 个域使用、是纯展示组件 | `base/` |

有域语义的模块不进 `utils/`：正文标记解析留在 `business/composer`、会话条目读法与消息流派生
（`chat-item` / `goal-turns` / `session-activity`）留在 `business/chat`——它们看着像工具，实际只服务一组界面，
搬进 `utils/` 只会让它重新变成杂物间。后两个是被 `chat` / `goal` / `session` 三处引用过的，
但那三处本来就是同一层投影被拆到了三个目录：**共享是拆分造成的，不是真通用**，
正确做法是把投影收回 `chat/`，让 `goal/` 与 `session/` 的展示件只从 `chat/` 借类型（数据由 `chat-panel` 以 props 传入）。

## 分层

| 层 | 位置 | 职责 | 禁止 |
| --- | --- | --- | --- |
| 原语 | `packages/ui/src/base/` | 纯展示，只关心 props | 调接口、读全局状态 |
| 业务组件 | `packages/ui/src/business/<域>/` | 组合原语、经 hooks 读 SDK store、渲染业务数据 | 直接 `fetch`、直接操作 DOM 存储 |
| 状态层 | `packages/ui/src/hooks/` | 跨域复用的 SDK store 订阅、派生与动作转发 | 渲染 JSX、自持跨组件状态 |
| Provider | `packages/ui/src/provider/` | 注入应用层创建好的 `client`；外观偏好的读写与应用 | 自行创建 client / 依赖模块级单例 |
| 跨域方法 | `packages/ui/src/utils/` | 无 React 依赖的通用方法与类型出口（路径、时间、存储、剪贴板、格式化） | 依赖组件与 React |

域内允许自定义私有 hook 与纯逻辑（`business/<域>/use-*.ts`、`business/<域>/<name>.ts`），
它们只服务本域，不上提到 `hooks/` 与 `utils/`。

**域间依赖是单向的**，允许的边只有下表这些，其余（尤其是反向与成环）都算摆错了位置：

| 域 | 可以依赖的其他业务域 |
| --- | --- |
| `chat` | attachment · composer · dialog · goal · markdown · session |
| `session` | composer · dialog |
| `composer` | attachment · dialog · workbench（只用项目行的 git 状态） |
| `workbench` | dialog · markdown |
| `settings` | dialog · notify · session · workbench |
| `notify` | session |
| `shell` | composer · session |
| `markdown` | attachment · dialog |
| `attachment` | dialog |
| `dialog` · `usage` | 无（只依赖下层） |
| `goal` | chat（只取消息流里的展示件，如分隔行；不取投影与数据） |
| `presets` | 全部 |

每个域都可以依赖 `base` / `utils` / `hooks` / `provider` 与包根的 `types.ts`；
`import type` 的边不计入方向（`hooks/store/use-chat` 取 `ComposerPayload` 类型、
`provider/workbench` 取 `WorkbenchDoc` 类型都是这种）。工作台去引用消息流的渲染件、`utils` 去引用组件，
这类同层反向或下层引用上层的写法仍是错的。

- **数据自服务**：业务组件经 `hooks/use-*` 读 SDK store（会话、消息、目标、交互…），不再由应用层透传控制器
- **导航受控**：当前会话、设置分区等平台相关状态由应用层持有，以 props 传入（`sessionId` / `onSelectSession` /
  `settingsSection` / `onSettingsSectionChange`），UI 不定义导航抽象、不写 URL
- **组合优先**：应用层拼装 `base/*` 与 `business/*`；`presets/workspace` 只是一套默认组合，任何应用都可拆开自拼
- 事件回调用 `on<动词>` 命名；纯函数下沉到本域目录或 `utils/`，可单独测试

## 公开面

外壳只能用 `packages/ui/package.json` 的 `exports` 声明过的子路径（`pnpm verify` 的 ui-exports 项兜底）：

| 子路径 | 公开面 |
| --- | --- |
| `./base/*` | 原语全集（`.tsx`）——外壳可以拿单个原语拼自己的界面 |
| `./business/*` | **业务组件**（`.tsx`）：外壳可以拿 `chat/chat-panel`、`session/session-sidebar` 这类组件自拼布局 |
| `./hooks/*` | 跨域复用的 React 绑定（含 `store/`） |
| `./utils/*` | 跨域通用方法 |
| `./provider` · `./presets/workspace` · `./theme.css` | 预置入口与样式 |

**域内的逻辑与 hook（`business/**/*.ts`）是内部实现，不在公开面内**：要复用的能力应该先上提到 `hooks/*`
（React 绑定）或 `utils/*`（无 React 的通用方法），而不是直接深链某个域的实现；真的只属于某个域、
又确实要给外壳用，才给它加一条具名 exports。
按 Node 的子路径模式，通配只能映射到一个具体后缀，所以 `./business/*` 引不到 `.ts`——这是有意的边界，不是缺口。

三条通配的后缀与目录实际内容由 ui-exports 校验看着（`base/` 全 `.tsx`、`hooks/` 与 `utils/` 全 `.ts`；
`business/` 允许同时有 `.tsx` 与 `.ts`），exports 目标必须存在，外壳的每一条引用都必须能解析到存在的文件。

## props 约定

- 用 `type XxxProps = { ... }` 声明，字段逐个写注释；类型名与组件同名
- `className` 一律透传并合并：`cn("base", className)`
- 其余原生属性用 `...props` 展开，不逐个转写
- 布尔 prop 用肯定语义（`disabled`、`streaming`、`dense`），不用反义命名
- 变体用 `cva` 而不是三元堆叠；本项目自己的组件优先 `className` + `cn`，只有真正多变的才上 `cva`
- 不传「样式开关」类 prop（`hideBorder`、`big`）；需要不同外观就在调用处传 `className` 或拆组件
- 选项数据（`SegmentedOption` 这类）可以带类名字段：窄容器里收起某项的文案由调用方传类
  （`sr-only` 加阈值变体，如 `sr-only @[30rem]:not-sr-only`），原语不认容器查询。藏文案要让单选钮保住可访问名——
  用 `sr-only`，不用 `hidden`
- **包裹类关注点**可以由 prop 内聚（`Button` 的 `tooltip`、`CopyAction` 的复制反馈）：它们不改动内容结构，
  只为内容包一层容器。内容是另一回事——插槽仍走 children，`icon` / `title` 这类 prop 只用来接文案

## 状态覆盖矩阵

每个组件都要过一遍下列状态，缺哪项就补哪项：

| 状态 | 要求 |
| --- | --- |
| default | 默认外观 |
| hover | 用语义类（`hover:bg-state-hover`），不写死颜色 |
| active / selected | 用语义类区分（按下 `bg-state-active`、选中 `bg-state-selected`），不能只靠字重 |
| focus-visible | 必须有 `focus-visible:ring-2 focus-visible:ring-ring/50`，键盘可达 |
| disabled | `disabled:opacity-50 disabled:cursor-not-allowed`，并阻止事件 |
| loading | 图标 + `animate-spin` 或 `Skeleton`，文案用「加载中…」；200ms 内不显示指示 |
| empty | 给出下一步动作；列表/搜索结果为空也要有一句说明，不留空白 |
| error | 就近显示原因，用 `text-destructive` / `bg-destructive/10` |
| running / streaming | 与普通态可区分，且不阻塞其它交互 |

状态用 `data-*` 属性表达，样式通过 `data-[state=...]:` 变体取值。

**隐藏式操作**：行内操作按钮可以默认隐藏（悬停或聚焦时显现），但必须保留占位（绝对定位或固定宽度），
不能让它在出现时挤压同行内容。键盘路径同样要能显现（`focus-visible`）；**触屏没有悬停态，这类操作一律常驻**
（`[@media(pointer:coarse)]:opacity-100`，共用 `HOVER_ACTION_CLASS`，见 `ui/src/utils/hover-actions.ts`）——
否则移动端要么看不到入口，要么是一枚「看不见但点得到」的盲区。

## 可访问性

- 纯图标按钮一律用 `IconButton`：`label` 同时是 `aria-label` 与悬停说明（一个动作只写一份文案），
  它已经把 tooltip（含按下态）挂好，不要再手写 `<button>` + `title`。存量还有十几处没迁（会话侧栏的设置、
  标签条关闭、选择器触发钮、goal 栏、provider 详情等）：改到哪处顺手收哪处，新写的不要再加。
- `title` 只在截断兜底时用（挂在 `truncate` 的那一层）；讲操作的用 Tooltip，即 `Button` 的 `tooltip` prop。
  两者并存会让同一颗按钮先后弹两次——Radix 不摘原生 `title`，浏览器灰框约 1 秒后才出
- 表单控件与 `Label` 关联；同一控件的说明文字用 `aria-describedby`
- 互斥选项组用原生 `fieldset` + `legend` + `radio`，不能只靠视觉高亮表示选中
- 装饰性元素（水印、纯装饰图标）加 `aria-hidden`
- 弹层支持 `Esc` 关闭与焦点回收；用 Radix 原语，不手写
- 键盘焦点顺序与视觉顺序一致

## 组件选型

- 2–4 个互斥选项用分段控件（布尔类开关除外，它用开关）；超过 4 个改用下拉
- 单个动作用按钮，布尔开关用开关；「标题 + 说明 + 控件」成组的用设置行
- 需要搜索、分组、带说明的选择用弹出层面板；选项少且无需说明时用普通下拉
- 互斥选项需要带说明时用 `base/dropdown-menu` 的 radio 组（`PickerOptions`）：`select` 塞不下副标题。
  同一组相邻控件（如输入区工具栏的模型 / 模式 / 权限 / 思考）保持**触发钮**同形，不因某一项没说明就混用两种控件；
  触发钮同形不等于弹层同形——模型要按 provider 分组，仍用 Popover 列表

## 弹层的调用方式

弹层**默认函数式调用**（`packages/ui/src/business/dialog/queue.ts`）：调用方不持有 open 状态，等 Promise 拿结果。

- `confirm({ title, description?, confirmText?, cancelText?, destructive? })` → `Promise<boolean>`：确认是 `true`；
  取消 / Esc / 点遮罩 / 宿主卸载都算 `false`。
- `alert({ title, description?, confirmText? })` → `Promise<void>`：单按钮的阻塞式告知。
- `openDialog<T>((close) => <Xxx onCancel={() => close()} />)` → `Promise<T | undefined>`：自定义弹层用这个，
  `close(result)` 把结果交回调用方，省略即 `undefined`。

队列串行——同一时刻只渲染队首，避免多层遮罩叠在一起；渲染由 `business/dialog/dialog-host` 负责，它挂在工作区里
与 `Toaster` 并列，未挂载时调用会同步报错（别让调用方的 await 悬着）。因此弹层组件自己不持有 open 状态：
**挂载即打开，收起即结算**。

少数弹层仍写声明式（受控 `open` + 常驻挂载）：设置全屏页、用量面板、命令面板、设置里的表单弹层。
判断依据只有一条——**谁持有开关**：开关由调用点临时决定（点一下、拿个结果就走）就用函数式；
属于界面结构的一部分、随页面状态常驻就用声明式。

## 决策区

「等用户作答」的三件事（权限审批、question 提问、计划决策）共用 `business/chat/decision/decision-panel`：**用绝对定位盖在输入区上把它挡住**。

输入区仍留在原位（布局不跳），只是这段时间接不到事件；面板与输入区在同一个定位上下文里（`ChatPanel` 里包一层
`relative`），分两层：`inset-0` 的**底衬**把输入区整段（含它的上边框）盖住并接住事件——面板宽 `max-w-4xl`，
未必盖得住整段，露出来的地方只能靠底衬；面板浮在底衬上、`bottom-4` 与整段下沿留出间距，内容更高时向上撑开
盖住对话尾部，自身限高（`max-h-[70vh]`）并内部滚动。面板之外的对话照常滚动与点选。

优先级是「待答交互 > 计划决策」，子会话只读、没有决策。权限与计划共用 `DecisionHeader`
（图标 + 标题 + 来源子会话），正文与底部按钮各自决定——权限是「对象 + 三个结论」，计划是「说明 + 补意见 + 批准」。

问答是**分步**的：一次只显示一题，头部是「进度 + 步点 + 折叠」（不再用 `DecisionHeader`，步点按
「答过 = 强调色、当前未答 = 前景色、其余最浅」上色），题面下给「选择一个答案 / 选择多个答案」，
选项做成带圆点的卡片，「输入自己的答案」也是其中一张，底部左「忽略」、右「返回（非首题）+
下一步 / 提交」（⌘⏎ 与主按钮同效）。步点兼作跳题入口（点哪段跳哪题），主按钮不校验是否作答——
没答的那题按跳过交给模型。Esc 或折叠箭头只收起选项卡片，题面与底栏留着——收起是为了
腾出地方看对话，不是退出作答。同一题里选项与自填互斥：点选项清掉自填，开始打字清掉已选项，
答的是哪一个一眼能看清。

## 组合模式

- 用 children / slot 组合，不用布尔 prop 堆叠。要「带图标的按钮」就传 `<Button><Icon/>文案</Button>`，
  不要 `<Button icon="plus" />`
- 需要把行为注入子元素时用 `asChild`（Radix `Slot`）
- 容器与内容分开：外框 + 分隔线是一层，行内容是另一层；新增同类界面直接复用容器
- 组件不感知路由与全局状态；会话 id、当前模型等都由上层传入

## 示例

具体写法直接读现有组件即可，下列只是**举例**，不代表必须覆盖的范围：

- 列表行（选中态、相对时间、隐藏式操作）：`business/session/session-list-item.tsx`
- 弹出层面板（分组、条目说明）：`business/composer/picker/model-picker.tsx`
- 分组设置（容器 + 行 + 右侧控件）：`business/settings/settings-row.tsx`
- 域内的编排与派生（组件 + 私有逻辑 + 私有 hook 同处）：`business/chat/`、`business/workbench/git/`
