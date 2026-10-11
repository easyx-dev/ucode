# 界面规格

各块界面怎么搭：分区、间距、层级与具体取值。通用规则（token、颜色、排版、圆角、阴影、动效、状态）见
[`DESIGN.md`](../DESIGN.md)，组件的结构与行为见 [`components.md`](./components.md)。

## 应用骨架

主区是三栏：侧栏 | 对话区 | 工作台，用 `base/resizable`（底层 `react-resizable-panels`）。
尺寸一律用**像素**（库把数字当像素、字符串当百分比），栏宽不随窗口缩放，但随界面密度缩放（走 `--base-unit`）。

| 位置 | 取法 |
| --- | --- |
| 侧栏 | 200–400，默认 288；**收起时不参与分栏**（用状态决定是否渲染面板，不用 CSS 隐藏） |
| 对话区 | 400–不设上限，占剩余；上下留 `my-2`，水平间隙交给分隔条（侧栏收起后分隔条一并消失，左间隙改由卡片自己的 `md:ml-2` 留出） |
| 工作台 | 400–不设上限，默认 640（展开时按窗口夹取）；与对话区同形的内容卡（`bg-card` + `md:rounded-xl` + `md:border`），外侧留 `py-2 pr-2` |
| 开关 | 侧栏按钮在最左、工作台按钮在对话区右上角，图标随状态切换 |
| 持久化 | 按栏记宽度（像素），键 `<slug>-panels-<组名>`；收起状态另记（`-sidebar-collapsed`、`-workbench-open`） |

- 分隔条**不画线**：栏与栏靠底色差分层。命中区就是栏间距——侧栏侧 12px（`-ml-3` 叠到侧栏右边缘留白上）、
  工作台侧 8px（与卡片 `m-2` 对齐）、工作台内部侧栏侧 6px（`-ml-1.5`），悬停只有 `cursor-col-resize`，
  键盘聚焦给 `focus-visible:bg-ring/40`。
- 需要可见分界时用**面板自己的边框**（如文件树列自带 `border-r`），不用分隔条。
- 恢复宽度用每个面板自己的 `defaultSize`，不用库的 `defaultLayout`（收起某栏后面板数会变，记忆会被忽略）。

## 交互嵌套

一行本身可点时用 `button`（或 Radix 触发器），**里面不能再放可交互元素**：需要第二个动作（如「点路径打开预览」）
就把动作做成同级按钮，让触发器的命中区缩到「图标 + 名称」那一截。按钮里套按钮会产生无效 HTML，读屏与键盘焦点都会错乱。

## 工作台面板

VSCode 式的「活动栏 + 侧栏 + 编辑器区」，条状区高度与列表行高统一：

| 区域 | 取法 |
| --- | --- |
| 活动栏 | 宽 40px，`border-r border-border`，竖排图标按钮（`size-8`）：项目文件 / 源代码管理 / 全部改动，最下是收起面板 |
| 侧栏 | 宽 180–360（默认 240）；顶部一行控件（根名 + 筛选 + 刷新 / 改动与历史切换 + 分支 + 刷新），列表行高 28、`rounded-lg`、选中 `bg-state-selected` |
| 标签条 | 高 36px（与对话区头部同档），`border-b border-border`；一份文档一格、溢出横滚；每格是「标题按钮 + 关闭按钮」两个同级元素 |
| 编辑器区 | 占剩余宽度；内容自带 36px 工具条与滚动区；diff 用行号 + 增删底色 + 语法高亮（着色值走 `--code-*`，适配器见 `lib/shiki-diff.ts`） |
| 空态 | 垂直居中：图标 `size-7 text-foreground-subtle` + 主文案 `text-sm font-medium` + 说明 `text-xs` |
| 分界 | 活动栏与侧栏各自用 `border-r` 画可见分界；侧栏与编辑器之间的分隔条不画线 |

- 目录行只用折角符（`ChevronRight` 转 90°），不叠文件夹图标；文件按类型给图标（`lib/file-icons.ts` 的映射），不引图标资源。
- 图标一律 `size-icon-sm text-foreground-subtle`。
- 文件树的 git 装饰：改过的文件名用状态色（`git-*`）并在右侧给字母徽标（`U` / `!` / `M` / `A` / `D` / `R`…），
  目录按「其下最重的那一个标记」着色、不加字母——颜色与字母都只表达状态。
- diff 默认双栏（并排）并记住选择（键 `<slug>-diff-mode`，另有 `<slug>-diff-wrap`）：横向溢出由编辑器内容区整块滚动，
  行与表格宽度跟随内容，底色不会在横向滚出来的区域断掉。渲染与配色由 `@git-diff-view/react` 提供，配色在
  `styles/third-party.css` 里整组改写成语义 token。
- 「全部改动」把多个文件的 diff 堆叠成一份文档：每块带文件头（状态、路径、增删）与折角，块内容进入视口才取数。
- 窄屏（< 768）抽屉铺满屏幕宽度，面板内退化成单列：侧栏与编辑器区互斥，打开文件即切到编辑器，标签条最左给返回箭头。两侧由 `sidebarVisible` **一个状态**决定——打开文档即收起侧栏、返回箭头即展开、点活动栏当前视图图标即收起（看编辑器）、点另一个视图图标即展开并切换；不要为此另立一份局部状态，否则活动栏的图标会点了没反应。

## 消息区

对话流不是卡片列表，而是页面底色上的一列内容：分层靠留白、字号与颜色，不靠外框。
实现落位 `lib/chat-rows.ts`（扁平行投影）、`business/message-row.tsx`（行渲染）、`business/message-list.tsx`（虚拟滚动）。

| 元素 | 取法 |
| --- | --- |
| 行间距 | 行首用 padding：新一轮 `pt-6`、轮内 `pt-3`。**不能用 `space-y-*` / `mt-*`**——虚拟列表按元素高度测量，margin 不计入会让滚动位置算错 |
| 用户消息 | `bg-muted/60` + `border border-border` + `rounded-lg`，右对齐，`max-w-[85%]`；不用反色气泡 |
| 用户消息的 chip | 句子外的技能 / 命令排在气泡上方，句子里的 `@` 引用就地渲染；两类同一套外观（`rounded-full` + `bg-muted` + `text-xs`），引用可点开工作台预览 |
| 图片 / 附件 | 正文里一律是带描边的等宽文字 token（`rounded-md` + `border-border` + `bg-background` + `font-mono text-xs`，前带 `size-icon-xs` 类型图标），内容是 `图片<序号>` 与文件名；点开原图弹层或下载 |
| 过长的用户消息 | 超过 `max-h-80` 折叠（`overflow-hidden`），下方给「展开 / 收起」入口 |
| assistant 正文 | 直接铺在 `bg-card` 上，不套容器；排版交给 `.md-content` |
| 思考过程 | 只在展开聚合行后出现，仍是单行灰字（「思考过程」+ 时长），再展开才看正文 |
| 工具行 | 单行 `h-8`：图标 + 标题 + 入参摘要；**不设底色**，悬停只让末尾的小三角现身；展开体缩进 `pl-6`，输出用 `bg-muted/50` |
| 聚合摘要 | 连续的思考与工具调用折成一句灰字：「思考了 3 次，使用了 2 个 Shell，1 个 编辑」；无图标、无底色，悬停出小三角 |
| 提问段 | 一次提问与其答复**独立成段**：`bg-muted/40` + `ring-1 ring-border-strong` + `rounded-lg`，内部按「主题 / 问题 / 选项」排 |
| 审批记录段 | 与提问段同一套排版：结论行（允许为中性色、拒绝用 `text-destructive`，带盾形图标）+ 工具名与对象（`font-mono`） |
| 生成中提示 | 列表最后一行：`Spinner` + 「工作中」+ 实时耗时（`tabular-nums`）；按半秒刷新 |
| 轮页脚 | 模型 · 耗时，右侧是复制与分叉入口；**只在这一轮落定后才渲染** |
| 操作行 | 时刻 / 分叉 / 编辑 / 复制等悬停才现，用 `min-h-6` 占位避免出现时顶动内容 |
| 浮起入口 | 「回到底部」这类按钮走浮层取法：`bg-popover` + `ring-1 ring-border-strong` |

- 可展开的行一律不设 hover 底色——密集的工具行会把底色连成一片灰带；可点靠悬停时才现的小三角表达。
- 行的 key 取 `ChatItem.uid`（跨「乐观条目 → 权威条目」不变），**不能取 `id`**：key 一变整行会被卸载重建。
- 连续的思考与工具调用合成一行摘要；正文 / 图片 / 附件按定义打断聚合。
- 摘要报具体工具名与次数，不用粗分类计数；shell 类调用就叫 `Shell`。
- 失败不在摘要里报数与图标，只在展开后各条自带状态图标；**任何层级都不自动展开**。
- 正在处理的那一组（思考还在流，或组内有工具在跑）行尾要出加载指示。
- 用户参与过的交互（提问及其答复、权限确认）要独立成段，不并进聚合行。
- 「回到底部」与自动跟随由「用户是否贴着底部」决定，且**只在用户主动滚动时改写**。
- 生成中的那一轮不报模型与耗时（判断要在投影层做，不能靠条目的 `live` 标记）。
- 嵌套的可点行必须用具名 group（`group/thought` / `group/tool`），否则会被外层聚合行的悬停点亮。
- 一屏内的层级只有两档：正文 `text-sm` > 折叠行与摘要 `text-xs text-foreground-subtle`。

## 输入区

输入区是「在哪儿干活 + 说什么」两件事，分两层：

| 元素 | 取法 |
| --- | --- |
| 外层容器 | `rounded-xl bg-muted/50`，承载首行项目 / 分支条与内层白卡，也是粘贴 / 拖拽的落点 |
| 项目 / 分支条 | 首行 `px-2 py-2`（与列表行同高）；项目 chip 草稿态可下拉（`rounded-md px-1.5 py-0.5 text-xs` + `hover:bg-state-hover`），已有会话同形但只读；分支 chip 只在确实是 git 仓库且取得到分支名时出现 |
| 输入卡 | 内层 `rounded-lg bg-popover` + `ring-1 ring-border-strong`，聚焦只把 ring 换成 `ring-ring`（颜色变、粗细不变）；编辑区 `px-3 py-3`、`min-h-16`、`max-h-55`（消息「编辑重发」复用同一个编辑器） |
| 工具栏 | 左 `+`（附件 / 技能）· 模型 · 模式 · 权限；右 思考 · 发送 / 停止。均为无边框的 `text-xs` 轻量按钮，图标 `size-icon-sm` |
| 工具栏降级 | 左侧一组在窄容器（大字号 + 紧凑密度 + 三栏同开）下横向滚动，**不换行**（`whitespace-nowrap` + 子项 `shrink-0` + `overflow-x-auto`）；右侧的思考与发送固定可见 |
| 建议行 | 只在空态出现，排在输入卡**下方**（`rounded-full` + `border` + `text-xs`，带 `size-icon-sm` 图标），点击填入输入框而不是发送 |
| 空态 | 品牌图 + 按时段问候语，与输入卡同属居中一列 |

- 空态与对话态**共用同一个输入卡挂载点**（父节点不变）：hero 只让外层容器 `justify-center` 并把问候渲染在输入卡上方。
- 模式 / 权限 / 思考三个选择器都用菜单的 radio 组（选型见 `components.md`），弹层开在触发钮上方（`side="top"`）；
  带副标题的模式 / 权限固定 `w-72`，只有档位名的思考收到 `w-40`。
- 选择器的选项行：图标占一列（`items-start`），标题与副标题都从图标之后起排，间距 `gap-1.5` / `gap-1`；
  带副标题的行 `py-2`，只有标题的行 `py-1.5`；选中打勾跟着标题行走（单行 `items-center`、带副标题 `items-start`）。
- 项目弹层取「搜索行 + 单行条目」：面板 `rounded-xl`；搜索行 `h-11`（图标 `left-3.5 size-icon-base`、输入 `pl-9 text-sm`）；
  条目行 `px-2 py-3` + `gap-2.5`；名称重名的才在名字后补父目录名，全路径落在条目的 `title`。

## Markdown 渲染

正文由 `styles/markdown.css` 的 `.md-content` 一层渲染，解析与流式交给 `streamdown`
（唯一入口 `business/message-response.tsx`，对话正文、md 预览、压缩摘要共用）。

- 层级只有两档：正文 `text-sm leading-prose`，代码块与表格 `text-xs`；标题不与正文拉开字号，靠字重。
- 标题 `mt-5 mb-2`（首个元素不带上边距）；h1 用 `text-lg`、h2 用 `text-base`、h3 及以下 `text-sm`。
- 表格是一张**卡片**：卡片画在 `table` 自身（`rounded-lg border border-border` + `w-max max-w-full overflow-x-auto`），
  三处 `.md-content` 入口（对话正文、md 预览、全屏表格预览）因此长得一样；
  分隔只用横线（表头下一条 `thead tr:last-child th`、行间若干 `tbody tr:not(:last-child) td`），末行不画，交给卡片下边框收尾；
  表头不着色、字色弱一档（`text-foreground-subtle`），单元格 `px-3 py-2`；宽表仍然只滚表格自身。
  streamdown 默认那层「卡片 + 独立滚动容器」已由 `business/markdown-table.tsx` 整份替换，不要把它加回来。
- 正文图片：本站附件先取字节转 blob 再渲染（`business/attachment-image.tsx`）；外层用 `span`，因为正文里的图片常落在 `<p>` 里。
- 列表标记用 `text-foreground-subtle`；GFM 任务列表去掉圆点。
- 行内 code 与代码块都只换底色（`bg-muted`）不换色相；行内 code 取 `text-xs`，与正文的差距由底色承担。
- 代码块右上角有悬浮复制按钮（`business/code-block.tsx`），悬停或键盘聚焦时出现；复制的是源码原文，
  成功图标换成对勾并保持 1.5s（`business/copy-action.tsx`，消息页脚的复制共用）。
- Mermaid 图块（`.md-mermaid` + `.md-mermaid-viewport`）：底色用卡片色、`p-3`、圆角描边同代码块；
  高度上限 `max-h-105`，宽图在块内自己横向滚（`svg` 保持 `max-w-none`）。图源不完整或语法不支持时回落成代码块，不弹错误面板。
- 全屏查看（`business/fullscreen-dialog.tsx`，走 `openDialog`）：窄屏铺满、桌面 `90vw × 86vh`；
  图表与图片共用可缩放视口（`business/zoomable-preview.tsx` + `hooks/use-zoom-viewport.ts`）：
  视口内拖拽平移、滚轮平移、`Ctrl` 加滚轮与加减号键缩放，比例下拉给 50% / 100% / 200% 与「适配窗口」「重置缩放」。

## 空态与登录

- 空态：品牌水印（`BrandLogo` 大尺寸 + `opacity-[0.07]`）+ 按时段问候语（`text-xl font-semibold`）+ 居中输入卡 + 建议行；
  未配置模型时换成「还没有配置模型」并给配置入口。
- 登录页：`max-w-sm` 卡片（`rounded-xl border bg-popover p-6`），表单与按钮竖排，`space-y-5`。

## 设置

- 导航分组（基础 / 助理 / 服务）+ 分区页；窄屏退化成抽屉，导航项 `h-10 rounded-lg`，选中 `bg-state-selected`。
- 分区内容用 `SettingsGroup`（`rounded-xl ring-1 ring-border-strong divide-y divide-border`）+ `SettingsRow`（标题 + 说明 + 右侧控件）。
- 外观分区的控件选型：配色主题与深浅模式用分段控件；界面字号用滑块（14–22px，右侧显示当前值）；
  界面密度用分段控件（紧凑 / 默认 / 宽松）；界面字体用下拉（等宽固定为系统栈，不给设置项）。改动即时生效并落本地，没有「保存」按钮。
