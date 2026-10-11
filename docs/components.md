# 组件规范

前端组件的组织方式与约束。视觉取值（颜色 / 状态层 / 排版 / 尺寸与圆角 / 阴影与层级 / 动效）见 [`DESIGN.md`](../DESIGN.md)，
界面分块见 [`design-surfaces.md`](./design-surfaces.md)，本文只管组件的结构与行为。

**本文声明规范并举例，不列举组件清单**——清单会随实现漂移，需要靠人维护；规范应当稳定到不需要维护。

## 组件来源与维护

组件与 hooks 位于 `packages/ui`（`@ucode/ui`），web 与桌面端共用。基础组件
`packages/ui/src/base/**` 由 shadcn CLI 生成（配置见 `packages/ui/components.json`），但**只生成一次**：
之后与其它代码一样由我们维护，同等适用本仓库的格式化、命名、颜色 token 与行数规则。

- 新增基础组件用 `npx shadcn@latest add <name>` 生成，生成完即视为项目代码，按本规范整理
- 生成后要把 `@/` 导入改成包内相对路径，`@/lib/utils` 改成从 `cn` 包导入
- 对已经改过的组件再跑 CLI 会覆盖我们的改动，需要手工合并
- 唯一豁免：`base/` 下都是对 Radix 的薄封装，不要求写文件级注释

## 目录与命名

```
packages/ui/src/
  base/               # 基础组件（shadcn 生成后归我们维护）
  business/           # 业务组件，按功能分组
    settings/         # 同功能多文件放同名文件夹
    <kebab-name>.tsx  # 顶层业务组件
  hooks/              # SDK store 的 React 绑定与派生
  lib/                # 纯逻辑
  provider/           # UiProvider：注入应用层创建好的 client
  presets/            # 预置组合（workspace-layout）
  styles/theme.css    # 设计 token 与基础样式
```

- 一个文件一个主组件，文件名 kebab-case，与组件名对应（`xxx-card.tsx` → `XxxCard`）
- 同功能的多文件放同名文件夹；文件名与目录名同名时不重复语义（`settings/settings-row.tsx`，不是 `settings/settings-settings-row.tsx`）
- 子组件只服务单个父组件时留在父组件文件内，不单独开文件

## 分层

| 层 | 位置 | 职责 | 禁止 |
| --- | --- | --- | --- |
| 基础组件 | `packages/ui/src/base/` | 纯展示，只关心 props | 调接口、读全局状态 |
| 业务组件 | `packages/ui/src/business/` | 组合基础组件、经 hooks 读 SDK store、渲染业务数据 | 直接 `fetch`、直接操作 DOM 存储 |
| 状态层 | `packages/ui/src/hooks/` | SDK store 的订阅、派生与动作转发 | 渲染 JSX、自持跨组件状态 |
| Provider | `packages/ui/src/provider/` | 注入应用层创建好的 `client` | 自行创建 client / 依赖模块级单例 |
| 纯逻辑 | `packages/ui/src/lib/` | 无 React 依赖的纯函数（格式化、草稿、命令解析） | 依赖组件 |

- **数据自服务**：业务组件经 `hooks/use-*` 读 SDK store（会话、消息、目标、交互…），不再由应用层透传控制器
- **导航受控**：当前会话、设置分区等平台相关状态由应用层持有，以 props 传入（`sessionId` / `onSelectSession` /
  `settingsSection` / `onSettingsSectionChange`），UI 不定义导航抽象、不写 URL
- **组合优先**：应用层拼装 `base/*` 与 `business/*`；`presets/workspace` 只是一套默认组合，任何应用都可拆开自拼
- 事件回调用 `on<动词>` 命名；纯函数下沉到 `lib/`，可单独测试

## props 约定

- 用 `type XxxProps = { ... }` 声明，字段逐个写注释；类型名与组件同名
- `className` 一律透传并合并：`cn("base", className)`
- 其余原生属性用 `...props` 展开，不逐个转写
- 布尔 prop 用肯定语义（`disabled`、`streaming`、`dense`），不用反义命名
- 变体用 `cva` 而不是三元堆叠；本项目自己的组件优先 `className` + `cn`，只有真正多变的才上 `cva`
- 不传「样式开关」类 prop（`hideBorder`、`big`）；需要不同外观就在调用处传 `className` 或拆组件

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
不能让它在出现时挤压同行内容。键盘路径同样要能显现（`focus-visible`）。

## 可访问性

- 纯图标按钮必须带 `title` 或 `aria-label`
- 表单控件与 `Label` 关联；同一控件的说明文字用 `aria-describedby`
- 互斥选项组用原生 `fieldset` + `legend` + `radio`，不能只靠视觉高亮表示选中
- 装饰性元素（水印、纯装饰图标）加 `aria-hidden`
- 弹层支持 `Esc` 关闭与焦点回收；用 Radix 原语，不手写
- 键盘焦点顺序与视觉顺序一致

## 组件选型

- 2–4 个互斥选项用分段控件；超过 4 个改用下拉
- 单个动作、开关用按钮 / 开关；「标题 + 说明 + 控件」成组的用设置行
- 需要搜索、分组、带说明的选择用弹出层面板；选项少且无需说明时用普通下拉
- 互斥选项需要带说明时用 `base/dropdown-menu` 的 radio 组（`PickerOptions`）：`select` 塞不下副标题。
  同一组相邻控件（如输入区工具栏的模式 / 权限 / 思考）保持同形，不因某一项没说明就混用两种控件

## 弹层的调用方式

弹层**默认函数式调用**（`packages/ui/src/lib/dialog.ts`）：调用方不持有 open 状态，等 Promise 拿结果。

- `confirm({ title, description?, confirmText?, cancelText?, destructive? })` → `Promise<boolean>`：确认是 `true`；
  取消 / Esc / 点遮罩 / 宿主卸载都算 `false`。
- `alert({ title, description?, confirmText? })` → `Promise<void>`：单按钮的阻塞式告知。
- `openDialog<T>((close) => <Xxx onCancel={() => close()} />)` → `Promise<T | undefined>`：自定义弹层用这个，
  `close(result)` 把结果交回调用方，省略即 `undefined`。

队列串行——同一时刻只渲染队首，避免多层遮罩叠在一起；渲染由 `business/dialog-host` 负责，它挂在工作区里
与 `Toaster` 并列，未挂载时调用会同步报错（别让调用方的 await 悬着）。因此弹层组件自己不持有 open 状态：
**挂载即打开，收起即结算**。

少数弹层仍写声明式（受控 `open` + 常驻挂载）：设置全屏页、用量面板、命令面板、设置里的表单弹层。
判断依据只有一条——**谁持有开关**：开关由调用点临时决定（点一下、拿个结果就走）就用函数式；
属于界面结构的一部分、随页面状态常驻就用声明式。

## 决策区

「等用户作答」的三件事（权限审批、question 提问、计划决策）共用 `business/decision-panel`：**用绝对定位盖在输入区上把它挡住**。

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

- 列表行（选中态、相对时间、隐藏式操作）：`session-list-item.tsx`
- 弹出层面板（搜索行、分组、条目说明）：`model-picker.tsx`
- 分组设置（容器 + 行 + 右侧控件）：`settings/settings-row.tsx`
