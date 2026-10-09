# 设计规范

ucode 对话界面的视觉系统。实现落位：`packages/ui/src/styles/theme.css`（token）与 `packages/ui/src/components/`（组件）；
各端在 tailwind 入口 `@import "@ucode/ui/theme.css"` 并用 `@source` 扫描包内 className。

## 定位与气质

- **黑白单色品牌**：没有彩色品牌色。品牌感来自灰度分层、排版层级与克制的圆角，而不是色相
- **颜色只用于表达状态与数据**：功能色（成功 / 警告 / 危险 / 信息）与图表色是惟一的彩色出口
- **灰度外壳 + 白色内容卡**：`background` 是外壳底色，`card` / `popover` 是浮在其上的白面；
  两者刻意不同值，这是整个视觉语言的基础，不要抹平
- **低装饰**：默认无阴影、无渐变、无彩色光晕；分隔主要靠留白与极浅的描边
- 界面文字统一简体中文

## Token 三层

| 层 | 位置 | 规则 |
| --- | --- | --- |
| primitive | `theme.css` 里的 `oklch()` 字面量 | 只描述颜色本身，不带业务含义，不出现在组件里 |
| semantic | `--background` / `--primary` / `--success` 等 | 组件唯一可用的层 |
| 组件 | `components/` 里的 class | 通过 Tailwind 语义类使用，如 `bg-card`、`text-muted-foreground` |

**禁止**在任何组件里写裸色值（`#fff`、`text-black`、`bg-blue-500`），`scripts/verify` 的 `tokens` 检查会拦下。
`components/ui/**` 也在检查范围内——它是 shadcn 的一次性产出，之后由我们维护。

## 颜色

### 语义 token

| token | 用途 |
| --- | --- |
| `background` / `foreground` | 外壳底色与主文本 |
| `card` / `card-foreground` | 内容卡、面板 |
| `popover` / `popover-foreground` | 弹层、下拉、对话框、输入框 |
| `muted` / `muted-foreground` | 次级面板底、悬停与选中态；次级文本、描述、时间 |
| `secondary` | 次级按钮底 |
| `accent` | 悬停 / 聚焦底（与 `muted` 同值，语义上偏交互） |
| `border` / `input` | 描边、输入框边 |
| `ring` | focus-visible 光环 |
| `primary` / `primary-foreground` | 品牌：主按钮、发送键、开关开启态；浅色近黑、深色近白 |
| `sidebar*` | 左侧栏专用一组，与外壳同灰、选中态用 `sidebar-accent` |

### 功能色

功能色独立于品牌色，只表达状态。每个都有对应的 `-foreground` 用于实底上的文字。

| token | 语义 | 典型用法 |
| --- | --- | --- |
| `destructive` | 失败 / 删除 | 错误提示、危险按钮、diff 删除行 |
| `success` | 成功 / 新增 | diff 新增行、成功提示 |
| `warning` | 警告 / 需注意 | 权限标记（如「完全访问」）、降级提示 |
| `info` | 中性提示 / 链接 | 可点击的文件引用、信息条 |

### 图表色

`chart-1..5` 按**蓝绿主导**排序，前两色是最常出现的两条序列：

| token | 色相 |
| --- | --- |
| `chart-1` | 蓝 |
| `chart-2` | 绿 |
| `chart-3` | 琥珀 |
| `chart-4` | 紫 |
| `chart-5` | 青 |

同一图表内按序取色，不要跳着用；序列超过 5 条时优先合并，而不是引入第 6 个色相。

## 表面与描边

界面靠「底色差 + 极浅描边」分层，不靠阴影。四类表面各有固定取法，不要临时拼组合：

| 表面 | 取法 | 说明 |
| --- | --- | --- |
| 外壳 / 主区底 | `bg-background` | 最底一层，侧栏与主区之间不画分隔线 |
| 内容卡 | `bg-card` + `border border-border` | 主区内的大面板 |
| 浮层 | `bg-popover` + `ring-1 ring-foreground/10` | 下拉、弹出层、对话框、输入容器 |
| 分组容器 | `ring-1 ring-foreground/10` + `divide-y divide-border` | 设置分组这类「多行共用一张外框」 |
| 遮罩 | `bg-overlay` | 只为压暗背景；不能改用 `bg-foreground/*`，深色下会变成提亮 |

- 输入框聚焦时整卡提亮描边：`focus-within:ring-2 focus-within:ring-ring/40`
- 内容卡内不要再用 `bg-card` 套一层同类卡片，改用 `bg-muted/50` 或只加 `ring`（否则白叠白分不出层）
- 阴影只给真正浮起的层（弹层、对话框）用默认值，其余不写 `shadow-*`
- 滚动条在 `styles/theme.css` 的 base 层统一：细窄、圆头、无轨道底色，颜色取 `--border`（悬停
  `--muted-foreground`）；颜色全走语义 token，`.dark` 自动跟随。标准属性（Firefox）与
  `::-webkit-scrollbar-*`（Chromium / Electron）两条路都写，组件里不再单独改滚动条

### 分栏

三栏布局（侧栏 | 对话区 | 工作台）用 shadcn 的 `Resizable`（`base/resizable.tsx`，底层
`react-resizable-panels`）。尺寸一律用**像素**（库把数字当像素、字符串当百分比），栏宽不随窗口缩放：

| 位置 | 取法 |
| --- | --- |
| 侧栏 | 200–400，默认 288；**收起时不参与分栏**（`useIsDesktop` + 状态决定是否渲染面板，不用 CSS 隐藏，隐藏后面板仍占份额） |
| 对话区 | 400–不设上限，占剩余；`flex-1 min-w-0`，上下留 `my-2`，水平间隙交给分隔条 |
| 工作台 | 320–1200，默认 420；与对话区同形的内容卡（`bg-card` + `md:rounded-xl` + `md:border`），外侧留 `py-2 pr-2` |
| 开关 | 侧栏按钮在最左、工作台按钮在最右（对话区右上角），图标随状态切换（展开 / 收起） |
| 持久化 | 按栏记宽度（像素），键 `<slug>-panels-<组名>`；只在用户真正拖动时落盘，收起的栏位不会被清掉。收起状态另记：侧栏 `-sidebar-collapsed`、工作台 `-workbench-open` |

- 分隔条**不画线**：栏与栏之间靠底色差分层，分隔本身不可见。命中区就是栏间距——侧栏侧 12px
  （`-ml-3` 叠到侧栏右边缘的留白上，不额外占宽）、工作台侧 8px（与卡片自身的 `m-2` 对齐）、
  文件树与预览之间 6px，按 `className` 逐条给；悬停提示只有 `cursor-col-resize`，键盘聚焦时给
  `focus-visible:bg-ring/30`，否则键盘用户看不到焦点在哪
- 需要更明显的悬停 / 拖拽态时挂库给的 `data-separator` 状态属性，不要改回常驻的线
- 需要一条可见分界时用**面板自己的边框**，而不是分隔条：文件树列自带 `border-r`
- 拖拽、双击复位与键盘（方向键）由库提供；不自己实现命中区与光标
- 恢复宽度用每个面板自己的 `defaultSize`，不用库的 `defaultLayout`：后者只在「键数等于当前面板数」时才生效，
  收起某栏后面板数会变，记忆会被静默忽略

### 交互嵌套

- 一行本身可点时用 `button`（或 Radix 触发器），**里面不能再放可交互元素**：需要第二个动作（如
  「点这个路径打开预览」）就把动作做成同级按钮，让触发器的命中区缩到「图标 + 名称」那一截；
  把按钮或 `role="button"` 套进按钮里会产生无效 HTML，读屏与键盘焦点也会错乱

### 面板内部

工作台（右侧第三栏）是「标签条 + 左树右内容」的两栏工具，三处条状区高度与列表行高统一：

| 区域 | 取法 |
| --- | --- |
| 标签条 | 高 36px（与对话区头部同档），`border-b border-border`，底色跟面板（`bg-card`）；最左是树面板开关，最右是收起 |
| 标签 | 两个常驻标签，`rounded-lg` 药丸：激活 `bg-muted text-foreground`，未激活 `text-muted-foreground hover:bg-muted/60` |
| 左列（树面板） | 宽 200–360（默认 200）；顶部一行控件（改动：改动/历史切换 + 刷新；文件：根名 + 筛选 + 刷新），列表行高 28px、`rounded-lg`、选中 `bg-muted` |
| 左列分界 | 树面板自己的 `border-r`，不用分隔条（分隔条不画线） |
| 右列（内容） | 工具条（36px）与滚动内容；diff 用行号 + 增删底色，不叠语法高亮 |
| 空态 | 垂直居中：图标 `size-7 text-muted-foreground/60` + 主文案 `text-sm font-medium` + 说明 `text-xs` |

- 目录行只用折角符（`ChevronRight` 转 90°），不叠文件夹图标；文件按类型给图标（`lib/file-icons.ts` 的映射），不引图标资源
- 图标一律 `size-3.5 text-muted-foreground`
- 右列是「结果」、左列是「入口」：右列未选中时给空态，不做成隐藏入口的空白

### 语法高亮

代码高亮用 shiki（core + JS 引擎 + 按需语言），颜色不写十六进制，而是映射到 `theme.css` 里的
`--code-*` 变量；变量取值全部来自已有语义 token，因此深浅色自动跟随。

| 变量 | 取自 | 用于 |
| --- | --- | --- |
| `--code-comment` / `--code-punctuation` | `muted-foreground` | 注释、标点、运算符 |
| `--code-keyword` / `--code-tag` | `chart-4` | 关键字、标签 |
| `--code-string` | `chart-2` | 字符串 |
| `--code-number` | `chart-3` | 数字与常量 |
| `--code-function` / `--code-link` | `chart-1` | 函数、链接 |
| `--code-type` | `chart-5` | 类型与类 |
| `--code-property` / `--code-variable` | `foreground` | 变量与属性 |
| `--code-invalid` | `destructive` | 语法错误 |

- 这是项目里唯一把颜色用于「状态」之外的场景；新增语法类一律先复用上表，不新增色相
- diff 行不叠语法色：增删行用 `success` / `destructive` 底色与文字色，两套着色叠在一起反而更难读

## 圆角

基准 `--radius: 0.75rem`（12px），其余档位在 `@theme inline` 中由它派生。组件按下表取档，不要临时写 `rounded-[7px]`：

| 档位 | 计算 | 约值 | 用于 |
| --- | --- | --- | --- |
| `rounded-xl` | `1.4 × radius` | 17px | 内容卡、弹层、对话框、输入框 |
| `rounded-lg` | `1 × radius` | 12px | 按钮、控件、列表行 |
| `rounded-md` | `0.8 × radius` | 10px | chip、徽章 |
| `rounded-sm` | `0.6 × radius` | 7px | 小标记、代码片段 |
| `rounded-full` | — | — | 头像、圆形图标按钮、状态点 |

## 排版

字体 `Geist Variable`（`--font-sans`），正文与标题同族；代码、路径、工具名用 `font-mono`。
**沿用 Tailwind 默认字号档位，不自定义新档位**，只规定用法：

| 场景 | 类 | 说明 |
| --- | --- | --- |
| 正文、消息内容 | `text-sm` | 默认档 |
| 组件标题（会话标题、卡片标题） | `text-sm font-medium` | 不与正文拉开字号，靠字重区分 |
| 说明、时间、分组标题、次级信息 | `text-xs` | 配 `text-muted-foreground` |
| 空态问候语 | `text-xl font-semibold` | 界面上最大的正文层级，与输入卡、建议行同属居中 hero |
| 空态水印 | `BrandLogo` 大尺寸 + `opacity-[0.07]` | 品牌图（深浅色各自切图），纯装饰，不算文字层级 |
| 代码、路径、内联片段 | `font-mono text-xs` | 配 `rounded-sm bg-muted` |

- 中文正文用 `leading-relaxed`；密集列表用默认行高
- 字重只用 `normal` / `medium` / `semibold` 三档，不用 `bold`
- 不用斜体、不用全大写做标题

## 间距与密度

- 基准 4px；间距只用 Tailwind 的 `gap-*` / `p-*` 档位
- 控件高度：小 `h-7`、默认 `h-8`、大 `h-9`；图标按钮同高同宽
- 列表行高 36px（`h-9`），行内边距 `px-2`
- 卡片内边距 12–16px（`p-3` / `p-4`）；区块间距 16–24px

## 消息区

对话流不是卡片列表，而是页面底色上的一列内容：分层靠留白、字号与颜色，不靠外框。实现落位
`packages/ui/src/lib/chat-rows.ts`（扁平行投影）、`business/message-row.tsx`（行渲染）
与 `business/message-list.tsx`（虚拟滚动）；用户消息自成一体，在 `business/user-message.tsx`。

| 元素 | 取法 |
| --- | --- |
| 行间距 | 行首用 padding：新一轮 `pt-6`、轮内 `pt-3`。**不能用 `space-y-*` / `mt-*`**——虚拟列表按元素高度测量，margin 不计入会让滚动位置算错 |
| 用户消息 | `bg-muted/60` + `border border-border` + `rounded-lg`，右对齐，`max-w-[85%]`；不用反色气泡 |
| 用户消息的 chip | 句子外的技能 / 命令排在气泡上方，句子里的 `@` 引用就地渲染；两类同一套外观（`rounded-full` + `bg-muted` + `text-xs`），引用可点开右侧工作台预览 |
| 用户消息的图片 / 附件 | 正文里一律是带描边的等宽文字 token（`rounded-md` + `border-border` + `bg-background` + `text-foreground` + `font-mono text-xs`，前带 `size-3` 类型图标），内容是 `图片<序号>`（序号与「图片」之间不留空格）与文件名；图片点开原图弹层、附件点开下载，输入区编辑器里是同一套 token（assistant 侧的图片与文件块不受此约束） |
| 过长的用户消息 | 超过 `max-h-80` 折叠（`overflow-hidden`），下方给「展开 / 收起」入口；用户贴整段日志时不该把屏幕占满 |
| assistant 正文 | 直接铺在 `bg-card` 上，不套容器；排版交给 `.md-content` |
| 思考过程 | 只在展开聚合行后出现，仍是单行灰字（「思考过程」+ 时长），自己再展开才看正文 |
| 工具行 | 单行 `h-8`：图标 + 标题 + 入参摘要；**不设底色**，悬停只让末尾的小三角现身；展开体缩进 `pl-6`，输出用 `bg-muted/50` |
| 聚合摘要 | 连续的思考与工具调用折成一句灰字「思考了 3 次，使用了 2 个 Shell，1 个 编辑」：无图标、无底色，悬停出小三角 |
| 提问段 | 一次提问与其答复**独立成段**，不并进聚合行：`bg-muted/40` + `ring-1 ring-foreground/10` + `rounded-lg`，内部按「主题 / 问题 / 选项」排，选中的打勾并带出选项说明、未选中的淡一档；标题分「提问中 / 已提问 / 未回答」三态 |
| 审批记录段 | 一次权限确认的结论与对象**独立成段**，与提问段同一套排版：结论行（允许为中性色、拒绝用 `text-destructive`，带盾形图标）+ 工具名与对象（`font-mono`）；「本会话恒允」补一行授权范围，子会话发起的请求补一行来源 |
| 生成中提示 | 列表最后一行：统一的 `Spinner` + 「工作中」+ 实时耗时（`tabular-nums`）；起点取本轮用户消息的时刻，纯前端按半秒刷新 |
| 加载指示 | 只有 `base/spinner.tsx` 一处定义（`Loader2` + `animate-spin`），各处只覆盖尺寸；用图标就不再叠省略号 |
| 轮页脚 | 模型 · 耗时，右侧是复制与分叉入口；悬停才现；**只在这一轮落定后才渲染**——生成中的实时进度由尾部的生成中提示承担 |
| 操作行 | 时刻 / 分叉 / 编辑 / 复制等悬停才现，用 `min-h-6` 占位避免出现时顶动内容；复制成功后图标换成对勾并保持约 1.5s |
| 浮起入口 | 「回到底部」这类浮在列表上的按钮走浮层取法：`bg-popover` + `ring-1 ring-foreground/10` |

- 可展开的行一律不设 hover 底色——密集的工具行会把底色连成一片灰带；可点靠悬停时才现的小三角表达
- 行的 key 取 `ChatItem.uid`（跨「乐观条目 → 权威条目」不变），**不能取 `id`**：`message_end` 会把 `live-assistant-N` 换成服务端 id，快照刷新也会整批换掉；key 一变整行就被卸载重建，生成中看得出来闪一下。新增可展开的行时同样要求 key 只建一次（聚合行的 key 固定取首段的 key）
- 连续的思考与工具调用合成一行摘要，展开才按原文顺序回看每一段；正文 / 图片 / 附件按定义打断聚合
- 摘要报具体工具名与次数，不用粗分类计数、也没有「其他」兜底；两项以上用逗号分隔（各项自带数字，用「和」会和后面的数字挤在一起）
- shell 类调用就叫 `Shell`，不译成中文
- 失败不在摘要里报数与图标，只在展开后各条自带状态图标；**任何层级都不自动展开**（包括失败与执行中的调用），要不要看细节由用户决定
- 正在处理的那一组（思考还在流，或组内有工具在跑）行尾要出加载指示，不能只在工具运行时才出
- 用户参与过的交互（提问及其答复、权限确认）要独立成段：聚合行只报「用了几个什么工具」，把它并进去就看不到问了什么、选了什么、确认了什么
- 「回到底部」与自动跟随由「用户是否贴着底部」这一个状态决定，且它**只在用户主动滚动时改写**：自己发起的贴底滚动与实测高度的补偿也会触发 scroll 事件，那一刻距离可能仍大于阈值，拿去判断会把按钮误亮出来；跟随则在行数或总高度变化时重新落到最新一行
- 生成中的那一轮不报模型与耗时：这个判断不能靠条目的 `live` 标记（流式投影里它只在 `liveMessageId` 对得上时才置位），要在投影层用「是否正在进行」+ 轮次判断
- 思考与工具的行与摘要一律用 `text-muted-foreground`（入参再淡一档 `/70`），不与正文争注意力；完全隐藏思考走设置（外观 → 思考过程）
- 嵌套的可点行必须用具名 group（`group/thought` / `group/tool`）：无名 group 会被外层聚合行的悬停点亮，让整列小三角一起现形
- 一屏内的层级只有两档：正文 `text-sm` > 折叠行与摘要 `text-xs text-muted-foreground`

## 输入区

输入区是「在哪儿干活 + 说什么」两件事，分两层：

| 元素 | 取法 |
| --- | --- |
| 外层容器 | `rounded-xl bg-muted/50`，承载首行项目 / 分支条与内层白卡，也是粘贴 / 拖拽的落点 |
| 项目 / 分支条 | 首行 `px-2 py-2`（与列表行同高 36px）；项目 chip 草稿态可下拉（`rounded-md px-1.5 py-0.5 text-xs` + `hover:bg-muted`），已有会话同形但只读（无悬停反馈）；分支 chip 只在确实是 git 仓库且取得到分支名时出现 |
| 输入卡 | 内层 `rounded-lg bg-popover` + `ring-1 ring-foreground/10`，聚焦只把 ring 换成 `ring-ring`（颜色变、粗细不变，省得光标进出时抖一下）；编辑区 `px-3 py-3`、`min-h-16`、`max-h-[220px]`（消息「编辑重发」复用同一个编辑器，高度口径自然一致）；不在 `bg-card` 上再套 `bg-card` |
| 工具栏 | 左 `+`（附件 / 技能）· 模型 · 模式 · 权限；右 思考 · 发送 / 停止。均为无边框的 `text-xs` 轻量按钮，图标 `size-3.5` |
| 建议行 | 只在空态出现，排在输入卡**下方**（`rounded-full` + `border` + `text-xs`，带 `size-3.5` 图标），点击填入输入框而不是发送 |
| 空态 | 品牌图 + 按时段问候语，与输入卡同属居中一列 |

- 空态与对话态**共用同一个输入卡挂载点**（父节点不变）：hero 只让外层容器 `justify-center` 并把问候渲染在输入卡上方；挪动父节点会让编辑器重挂载、草稿与附件占位一起丢
- 模式 / 权限 / 思考三个选择器都用菜单的 radio 组（选型口径见 `docs/components.md`），弹层开在触发钮上方（`side="top"`）；带副标题的模式 / 权限固定 `w-72`（副标题压到一行放得下），只有档位名的思考收到 `w-40`
- 选择器的选项行：图标占一列（`items-start`），标题与副标题都从图标之后起排；图标与文字 `gap-1.5`，标题与副标题之间 `gap-1`；带副标题的行 `py-2`，只有标题的行 `py-1.5`；整行 `cursor-pointer`
- 选中打勾一律跟着**标题行**走：单行条目靠行容器 `items-center`（勾垂直居中就是标题行），带副标题的条目靠 `items-start`（勾贴标题行）——勾的落点是 `base/dropdown-menu` 里绝对定位的静态位置，由行容器的对齐方式决定，别在行里再补偏移
- 项目弹层取「搜索行 + 单行条目」：面板 `rounded-xl`；搜索行 `h-11`（图标 `left-3.5 size-4`、输入 `pl-9 text-sm`）；条目行 `px-2 py-3` + `gap-2.5`，左侧 `Folder size-4 text-muted-foreground`、名称 `text-sm truncate`、选中打勾靠右；名称重名的（两个目录末段同名）才在名字后补父目录名（`ucode · job`），全路径落在条目的 `title` 里；底下两条动作（选择目录 / 小助理）与条目同高同形，都带图标

## Markdown 渲染

对话区的正文由 `packages/ui/src/styles/theme.css` 的 `.md-content` 一层渲染（`react-markdown` + `remark-gfm`），
取值口径就写在那里，新增元素先看这一节再动：

- 层级只有两档：正文 `text-sm leading-7`，代码块与表格 `text-xs`；标题不与正文拉开字号，靠字重
- 标题 `mt-5 mb-2`（首个元素不带上边距），与段落一同构成长文的阅读节奏
- 表格**自己滚**：`block w-max max-w-full overflow-x-auto`。宽表不但撑破列宽，还会把整段对话变成
  横向滚动区；它按内容宽度渲染、上限不超列宽，超出时只滚表格自身。表头 `bg-muted/50`，
  单元格 `px-3 py-1.5` 且顶对齐（多行单元格不会被另一列拉歪）
- 列表标记用 `text-muted-foreground`；GFM 任务列表去掉圆点（勾选框本身就是标记）
- 行内 code 与代码块都只换底色（`bg-muted`）不换色相；字号仍只用 Tailwind 默认档位

## 阴影

- 默认无阴影，靠 `border` 与底色差分层
- 仅弹层、下拉、对话框可用极轻阴影（基础组件已带默认值，不要额外叠加）
- **唯一例外**：侧栏底部信息区与上方滚动列表之间用 `shadow-edge`（`--edge-shadow`，只有上边缘的一层极轻投影）——
  那里既没有内容卡可借边框、画线又太硬。除它之外不新增 `--shadow-*` 用法
- 禁止彩色阴影、大范围模糊光晕

## 动效

| 场景 | 时长 | 缓动 |
| --- | --- | --- |
| 颜色、悬停、聚焦 | 150ms | ease-out |
| 弹层出现 / 消失 | 200ms | ease-out |
| 流式光标 | 呼吸（`animate-pulse`） | — |

- 位移类动效（如按下 `translate-y-px`）必须在 `prefers-reduced-motion: reduce` 下关闭
- 不要为列表项加进入动画

## 图标

- 统一 lucide-react
- 行内图标 `size-3.5`（14px）或 `size-4`（16px），按钮内与其他文字同色（`currentColor`）
- 图标只作辅助，不单独承载语义；纯图标按钮必须带 `title` 或 `aria-label`

## 深色模式

- 用 `next-themes`，`attribute="class"`，在 `<html>` 上加 `.dark`；`@custom-variant dark (&:is(.dark *))`
- `defaultTheme="system"`，`storageKey="ucode-theme"`，`disableTransitionOnChange`
- 主题三态：浅色 / 深色 / 跟随系统，入口在设置对话框
- `index.html` 内联一段脚本，在首屏渲染前根据 `localStorage` 或系统偏好设置 `.dark`，避免闪白
- 深色下品牌色翻转（近黑 → 近白），分层关系保持不变；功能色提亮、降饱和

## 多主题扩展

当前只有浅色与深色两套。未来加主题时：

- 在 `theme.css` 新增 `[data-theme="<名>"]` 层，只覆盖 semantic token，**不动 primitve 结构之外的组件**
- 主题名只影响 token，不影响任何 `className`
- 新增主题必须同时给出浅色与深色两套值
