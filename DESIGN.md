# 设计系统

UCode 的视觉系统：token 定义在 [`packages/ui/src/styles/tokens.css`](./packages/ui/src/styles/tokens.css)，
原语与界面件在 `packages/ui/src/base/`，业务组件的视觉取值见 [`docs/design-surfaces.md`](./docs/design-surfaces.md)。
各端在 tailwind 入口 `@import "@ucode/ui/theme.css"` 并用 `@source` 扫描包内 className。

规范靠 `pnpm check` 兜底：`scripts/verify` 的 `tokens`（颜色）、`design`（尺寸与档位）、`themes`（配色主题）三项会拦下越界写法。

## 定位与气质

- **黑白单色品牌**：没有彩色品牌色。品牌感来自灰度分层、排版层级与克制的圆角，而不是色相。
- **颜色只用于表达状态与数据**：功能色与图表色是惟一的彩色出口。
- **外壳 / 面板 / 卡三层**：`background` 是外壳底色，`surface` 是对话区与工作台那层面板底，`card` /
  `popover` 是卡片与浮层的面。浅色由外向内逐层变亮（玻璃面 → 面板 → 卡），深色反向（外壳最亮、卡最暗，
  面板底与卡同色）。这是整个视觉语言的基础。
- **低装饰**：默认无阴影、无渐变、无彩色光晕；分隔靠留白与极浅描边。
- 界面文字统一简体中文。

## 体系规则

四层，引用方向单向：

| 层 | 位置 | 内容 | 谁能用 |
| --- | --- | --- | --- |
| 参数 | `tokens.css` 的 `:root` + 设置写入的行内变量 | 字号基准、密度、字体族、圆角 | 只被下一层引用 |
| 主题层 | `--theme-*`，覆盖在 `styles/themes/<id>.css` | 配色主题唯一可改的一组变量 | 只被语义层引用 |
| 语义层 | `--background` / `--state-hover` / `--foreground-subtle` 等 | 可被组件使用的名字 | 组件 |
| 映射层 | `@theme` 把语义层变成 `bg-background` 这类工具类 | — | 组件 |

硬约束：

1. **语义层的值永远是 `var()` / `color-mix()` / `calc()`**，不写字面色值；调色板底料只允许出现在 `tokens.css`。
2. **深色只改主题层**：语义层定义一次，靠 `.dark` 自动解析，不写两套语义。
3. **改字号只动 `--font-size-base`，改密度只动 `--density`**，绝不改 `html` 的 font-size（那会让 `rem` 二次缩放）。
4. **所有运行时可变 token 的值必须保持引用形式**，不能写成算好的字面量，否则设置改了不生效。
5. **准入**：同一取值被 ≥3 处复用才立 token；新 token 必须同时进本文件、`tokens.css` 与校验白名单。
6. 命名：颜色 `--<角色>`（映射成 `--color-<角色>`）、主题层 `--theme-*`、尺寸族 `--spacing-*`、高度层 `--elevation-*`、语法高亮 `--code-*`。
7. **玻璃面（`--glass`）**：外壳与侧栏用「外壳色朝叠加基准压一档、再掺 84% 透明」的面 + `backdrop-blur`
   （映射成 `bg-glass`）——压的方向跟着叠加基准走（浅色变深、深色变浅），玻璃面因此比外壳更远离面板那一侧。
   它透出来的是什么取决于背后有没有东西——**桌面端窗口透明**（`transparent` + macOS `vibrancy`）时透出系统材质；
   **web 端用纯色**（2026-10 定：不铺背景图），因此那里的玻璃面与实色观感一致，留着是为了「同色掺透 + 模糊」
   这层结构本身，日后要加背景图不必再动样式。面板底与内容卡仍是实色（`bg-surface` / `bg-card`，那是「纸」层）。

## 运行时参数

外观设置里四个旋钮，都存在设备本地（`localStorage`，键由 `@ucode/brand` 派生）：

| 参数 | 取值 | 影响范围 |
| --- | --- | --- |
| 界面字号 `--font-size-base` | 14–22px（默认 14） | **文字与图标**（图标是文字的图形化） |
| 界面密度 `--density` | 紧凑 0.9 / 默认 1 / 宽松 1.1 | **间距、控件高度、内容高度上限**（栏宽不走密度，见下）|
| 界面字体 `--font-ui-base` | 内置精选 + 系统栈 | 界面文字 |
| 等宽字体 `--font-mono-stack` | **不可配**：系统等宽栈 + 中文回退 | 代码、路径、diff、终端、工具名 |

- 字号与密度**刻意不联动**：允许「字大 + 紧凑」这种组合，观感取舍交给用户；大字号配紧凑密度时界面会更挤，这是选择的结果而不是缺陷。
- 派生链：字号 → 六档字号 + 图标四档 + 行高；密度 → `--base-unit = 0.25rem × density` → 间距基准、控件高度、高度层的 offset/blur。
  **栏宽不在这条链上**：它由 `utils/panel-layout.ts` 的像素常量（侧栏 288 / 工作台 640 / 树列 275）给定，
  密度变化不重算，也不缩写用户拖出来的宽度。
- 应用只有一个出口：`provider/appearance.ts` 的 `applyAppearance` 把参数写到 `<html>` 的行内样式与 `data-theme`；
  首屏由 `apps/web/index.html` 与 `apps/desktop/index.html` 的内联脚本按同一个键预先应用（否则会有一帧默认字号）。
- 界面字体按需加载：`@fontsource-variable` 的 CSS 入口在选中时才动态引入，未加载完用回退字体渲染；字体族名与清单在 `provider/fonts.ts`。
- 等宽只走系统字体，不打包 webfont：CJK 等宽字体（Sarasa Mono SC / Maple Mono CN）单字重就是几 MB，而收益只是「代码注释里的中文与 ASCII 严格 2:1 对齐」，不划算。栈里显式插入中文回退（见「排版」），中文能正常显示，代价是与 ASCII 不对齐。

## 颜色

底料全部来自 Tailwind 内置调色板变量（`--color-neutral-*` 等），语义层用 `var()` 与 `color-mix(in oklab, …)` 组装；
组件里禁止写调色板 utility 与调色板变量。深浅由主题层翻转，语义层不重复。
深色外壳与内容卡那一对灰、浅色面板底与次级底那两档灰在 Tailwind 内置档位里都没有对应值
（`neutral-900` 偏暗、`neutral-800` 偏亮；`neutral-50` 与 `white` 之间没有档位，`neutral-100`
与面板底只差 6/255、看不出底色），因此在 `tokens.css` 里自建四个底料（`--palette-shell-dark` /
`--palette-raised-dark` / `--palette-surface-light` / `--palette-muted-light`）——
**全仓库只有那一处允许写字面色值**，主题层与语义层一律引用它们。

### 表面与文本

| token | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `background` | 外壳底色 | `neutral-50` | `#2b2b2b`（自建底料） |
| `surface` | 对话区 / 工作台的面板底 | `#fbfbfb`（自建底料） | `#161616`（与 `card` 同色） |
| `card` | 面板里的卡片与浮起面（用量卡、diff 面、浮起按钮、选中的分段） | `white` | `#161616`（自建底料） |
| `popover` | 弹层、下拉、对话框、输入框 | `white` | `#161616`（自建底料） |
| `muted` | 次级面板底、悬停与嵌入块（代码块、表格头） | `#f2f2f2`（自建底料） | `neutral-700` |
| `secondary` | 次级实底（次按钮、次级徽标） | `neutral-200` | `neutral-700` |
| `foreground` | 主文本 | `neutral-800` | `neutral-200` |
| `inverse` | 反色面：用户消息气泡、tooltip 的底 | `neutral-800` | `neutral-700` |
| `inverse-foreground` | 反色面上的字 | `neutral-50` | `neutral-50` |
| `foreground-subtle` | 次级文本、描述、时间、图标弱化 | 前景 60% | 前景 60% |
| `foreground-subtlest` | 占位、最弱元数据、禁用邻接文案 | 前景 40% | 前景 30% |
| `border` | 描边、分隔 | 叠加基准 10% | 同 |
| `border-strong` | 浮层外框、分组卡外框 | 15% | 15% |
| `ring` | focus-visible 光环 | `neutral-400` | `neutral-500` |
| `overlay` | 遮罩（只为压暗背景） | 黑 40% | 黑 60% |

- 「叠加基准」浅色是近黑、深色是近白，所以描边、状态层、遮罩在两种模式下都朝同一方向变化。
- 三级文本是**唯一**的文本层级口径；不要用 `text-foreground/70` 这类自造透明度。
- 反色面（`inverse`）是**唯一不随深浅翻转**的一对：浅色近黑底 + 浅字，深色压到次级实底那一档（`neutral-700` 底 + `neutral-50` 字）。
  深色若也取近白，一整块用户气泡会成为画面里最亮的东西——小面积浮起（按钮、徽标）随深浅翻转，大面积反色面不翻。
- 透明度只用 `5 / 10 / 20 / 40 / 50 / 60 / 80` 七档（状态层在 CSS 里合成，组件不写）。

### 交互态

| token | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `state-hover` | 悬停底（行、菜单项、按钮） | 叠加 5% | 叠加 8% |
| `state-selected` | 选中底（列表行、侧栏项、展开中的触发钮） | 8% | 12% |
| `state-active` | 按下底 | 12% | 16% |

叠加式的好处：同一个 `hover:bg-state-hover` 落在 `surface`、`card`、`popover`、`muted` 上都保持同一层关系，不会因为底色不同而深浅乱跳。

### 功能色与数据色

| token | 用途 |
| --- | --- |
| `destructive(+foreground)` | 失败、删除、危险按钮、diff 删除行 |
| `success(+foreground)` | 成功、新增、diff 新增行 |
| `warning(+foreground)` | 警告、需注意（如放宽的权限档） |
| `info(+foreground)` | 中性提示 |
| `link` | 可点击的链接与文件引用 |
| `chart-1..5` | 图表色，按蓝绿主导排序（蓝 / 青绿 / 琥珀 / 紫 / 青），同一图表按序取色 |
| `git-modified` / `git-added` / `git-untracked` / `git-deleted` / `git-renamed` | 文件树的 git 状态色，独立一族，不借 diff 与警告色 |
| `window-control-close` / `-minimize` / `-zoom` / `-foreground` | 无标题栏窗口里自绘窗口控件的三颗点及其上的符号（`-zoom` 是绿点，AppKit 里这颗钮就叫 zoom button：默认进出全屏，⌥ 点击最大化）；固定色，不进主题层也不随深浅翻转（它们是系统语义，跟着配色主题变会被认错） |

- 功能色只表达状态，不用于装饰；不要为了「更醒目」而借用失败/成功色。
- 窗口控件色不复用 `destructive` / `warning` / `success`：它们表达的是「系统窗口怎么操作」，与状态语义无关。
- diff 的增删底色由 `success` / `destructive` 合成（`third-party.css` 里整组改写库变量），不新增独立 token。

### 高度层

| token | 用途 |
| --- | --- |
| `shadow-raised` | 轻微浮起（分段控件选中段、独立小卡） |
| `shadow-popover` | 下拉、菜单、浮层 |
| `shadow-dialog` | 对话框、抽屉 |
| `shadow-edge` | 侧栏底部信息区与列表之间的上边缘投影（唯一允许的非浮层投影） |

默认无阴影：结构靠底色差与描边。offset / blur 由 `--base-unit` 派生，所以密度变化时阴影一起走。

## 排版

- 字体：`--font-ui` = 设置给出的界面字体 + **固定的中文回退**；`--font-mono` = 系统等宽栈 + 同一份中文回退。
  等宽栈必须带中文回退：Windows 的 Consolas 不含中文字形，不带会落到宋体（JetBrains Mono、Geist Mono 同样没有汉字）。
- 六档字号，全部由基准派生（14px 基准下给出括号里的值）：

| 档 | 用途 | 基准 14px 时 |
| --- | --- | --- |
| `text-xs` | 次级说明、时间、徽标、行内代码、密集列表 | 12px |
| `text-sm` | 正文、控件、列表行（默认档） | 14px |
| `text-base` | 对话框标题 | 16px |
| `text-lg` | 用量等大数字 | 18px |
| `text-xl` | 空态问候语 | 20px |
| `text-2xl` | 全屏面板的页标题（设置） | 24px |

- 图表字号**另算**，不占上面的字号档位，只用于轴、刻度、图例与热力图标签：`text-chart-axis`（基准的 5/7）、`text-chart-label`（6/7）、`text-chart-value`（基准）。
- 文档标题（Markdown 正文的 H1 / H2）同样**另算**：`text-heading-2` 比正文大 1px、`text-heading-1` 再比 H2 大 1px，
  层次靠 1px 的级差与字重（`semibold`）拉开；h3 及以下与正文同档。
- 行高：密集 UI 用 `leading-tight`，默认由各字号自带（约 1.5em），长文正文用 `leading-prose`（1.75）。行高用 `em` 表达，字号变化时比例不变。
- 字重只用 `normal` / `medium` / `semibold`；不用 `bold`、不用斜体、不用全大写做标题。
- 字距全局 `0.4px`（`--tracking-base`，绝对值、不随字号缩放）：中英混排下汉字之间不至于拥挤，改一处即全局生效。
  局部要拉开时用 `tracking-*` 覆盖（全大写小字号微标签用 `tracking-widest`，快捷键标签是现例）。
- 数字类信息（耗时、用量、行号）加 `tabular-nums`。
- 中文换行由 `@streamdown/cjk` 在 Markdown 渲染层处理，组件不要覆盖 `word-break` / `line-break`。

## 间距与尺寸

- 基准 `--base-unit = 0.25rem × 密度`，所有 `gap` / `p` / `h` / `w` 都是它的整数倍。
- 允许档位：`0 / 0.5 / 1 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 12`（0–48px），由 `design` 校验按白名单守着——越档要先进这张表。禁任意值；相对约束（`max-w-[85%]`、`h-[60vh]`）用百分比与视口单位。
- 间距节奏：`1` 图标与文字 · `2` 行内间隙与紧凑控件内边距 · `3` 密集列表行内边距 · `4` 卡片与面板内边距 · `6–8` 区块之间 · `9` / `12` 图标占位缩进与空态留白。
- 控件高度：`h-6`(24) / `h-7`(28) / `h-8`(32，默认) / `h-9`(36)；方形图标按钮同宽同高。
- 行高表（随密度缩放）：主区列表行 36 · 工作台列表行 28 · 工具行 32 · 标签条 36 · 活动栏 40。
- 图标：`size-icon-xs`(12) / `-sm`(14) / `-base`(16，默认) / `-lg`(20)，由字号派生；更大的图形（空态插图、头像）用间距档。
- 图标线宽全局 `--icon-stroke-width`（1.5）：lucide 默认 2 在这套字号档下偏粗。例外只有桌面端窗口控件的符号
  （`size-2`，1.5 的线宽在这么小的符号上看不清），用内联样式写回 3。
- 窗口控件的点：`size-window-control`(14) 固定值，不随密度与字号走——它仿的是系统标题栏按钮，属于系统镶边。
- 面板与窗口四周边缘的间距 `--shell-inset`（1 档，密度默认下 4px）：由三栏骨架最外层的外壳容器统一留
  （`md:p-shell-inset`），面板自己**不写 margin**——留白归外层，需要精确纵向定位的地方（桌面端窗口控件的中线）
  可直接引用这个变量。
- 内容区高度上限用间距档表达（如 `max-h-105` = 420px），避免任意值。

## 圆角

基准 `--radius`（0.625rem），五档派生：`rounded-xs`(0.4×) / `rounded-sm`(0.6×) / `rounded-md`(0.8×) / `rounded-lg`(1×) / `rounded-xl`(1.4×)，另有 `rounded-full`。

取档只看**容器嵌套层级**，不看组件重要性：

- 第一个圆角容器一律 `rounded-xl`；嵌套时逐级降为 `lg → md → sm → xs`（`xs` 为下限）。
- 例外：贴窗口边缘的面板（对话区、工作台）用 `rounded-md`——它们的圆角要与无标题栏窗口自身的圆角相称，
  取 `xl`（14px）会在窗口角上露出错位的月牙。
- 控件（按钮、选择器）默认 `rounded-lg`；落在 `rounded-lg` 父容器里降为 `md`，落在 `rounded-md` / `sm` 里降为 `sm`。
- 体量小的这几类统一 `md`：输入族（`Input` / `InputSearch` / `Textarea`）、图标按钮四档（`icon-xs` / `icon-sm` / `icon` / `icon-lg`）、分段控件、工作台侧栏那批 28px 列表行（文件树 / 改动树）——它们跟相邻的 chip、行内元素同一档。段控件这类「控件里还嵌一层选中项」的结构按**同心**取档：外圈档位减去容器内边距（`md` 容器 + `p-0.5` → 选中项 `sm`），内圈与外圈共一个圆心。
- `xs`（基准的 0.4×）只给行内的微元素：徽标与同类 chip（技能 / 命令 chip、附件 token、子智能体入口、活动摘要条、
  空态建议 chip）、行内图标按钮（复制 / 分叉 / 编辑 / 展开收起 / 关闭）、Markdown 行内代码、
  用户气泡的右下角。面板与控件本体不用它——面板边上出现 4px 的圆角会读成直角。
- 用户消息气泡：`rounded-lg`，右下角单独收一档到 `rounded-br-xs`，读起来像说话的一角。
- 布局容器、分隔条、包装层不算一层。
- `rounded-full` 只留给真正的圆形与刻意做胶囊的浮起控件：状态点、进度条、滑块、开关、滚动条，「回到底部」这类浮起的胶囊按钮；
  徽标与 chip 用 `xs`，不做胶囊。禁任意值与 `rounded-2xl` 及以上；裸 `rounded`（编译成固定 `0.25rem`）
  与 CSS 里显式写的 `border-radius` 字面值同样禁——两者都不跟 `--radius` 走，由 `pnpm check` 的 design 校验兜底。

## 层级

| z | 用途 |
| --- | --- |
| `10` | 局部浮起（图表提示、吸顶的编辑器工具条） |
| `20` | 粘性条 |
| `50` | 弹层与遮罩（下拉、菜单、选择、提示、对话框、抽屉） |
| `chrome` | 系统窗口镶边：无标题栏窗口里的自绘窗口控件与拖拽条。它扮的是系统标题栏，在应用所有层之上——弹层打开的遮罩也不得盖住它，否则窗口关不掉也拖不动 |

- 同层多个浮层靠渲染顺序（Portal 顺序）决定，不再加数字。
- toast 由 sonner 自管（其 toaster 的 z-index 远高于上面的档位），不参与本表。

## 动效

- 时长三档：`100ms`（遮罩淡入淡出）、`150ms`（颜色、悬停、聚焦，默认）、`200ms`（弹层出现与消失）；三档只管交互过渡，循环类动效（加载扫光、状态条扫光）自定周期。
- 缓动只用 `ease-out`；线性只用于扫光这类持续动画。
- 属性只做 `colors` / `opacity` / `transform`；禁 `transition-all`。
- 位移类动效（按下 `translate-y-px`）必须在 `prefers-reduced-motion: reduce` 下关闭；呼吸类动画同理由基础层统一关闭。
- 不为列表项加进入动画：长列表滚动时它只会变成噪音。

## 渐变

默认**不使用装饰渐变**。唯一允许的两处来自工具链：

- `shimmer`（加载中的文字扫光，来自 `shadcn/tailwind.css`）；
- `scroll-fade`（滚动边缘的蒙版渐变，用于提示还有内容）。

禁止在组件里自造 `linear-gradient`；确需新渐变时先写进本文件并登记校验白名单。

## 反馈

四个层次，按「影响范围」选择，不要越级：

| 层次 | 用在 | 形态 |
| --- | --- | --- |
| 就地 | 字段校验、复制成功、动作进行中 | 控件旁的文字 / 图标切换（成功后图标变对勾并保持约 1.5s） |
| 轻提示 | 动作结果、非阻塞错误 | toast（一到两行，不给按钮，除非提供「撤销」） |
| 阻塞确认 | 不可恢复的破坏性动作 | `confirm` 对话框（标题 + 一句后果 + 破坏性按钮） |
| 决策面板 | 等用户作答（权限、提问、计划） | 盖住输入区的面板，见 [`docs/design-surfaces.md`](./docs/design-surfaces.md) |

- 加载三态：200ms 内不显示指示；超过就出局部 `Spinner`；首屏列表用 `Skeleton`（尺寸贴近最终内容，避免跳动）；
  长任务用「工作中 + 实时耗时」一行。
- 空态必须有五要素：图标、主文案、说明、一个明确的下一步动作、以及不留空白。
- 错误就近显示并给重试入口；不丢上下文、不覆盖用户已输入的内容；服务端错误按 `ERROR_CODES` 渲染（见 [`docs/api.md`](./docs/api.md)）。
- 乐观更新只用于「几乎必然成功且可回滚」的动作，失败必须回滚并提示。

## 状态矩阵

每个可交互元素都要过一遍；视觉取值如下，行为要求见 [`docs/components.md`](./docs/components.md)。

| 状态 | 视觉 |
| --- | --- |
| default | 底色按表面取法，文字 `foreground` |
| hover | `bg-state-hover`，150ms 过渡 |
| active / 按下 | `bg-state-active`；位移只用于按钮（`translate-y-px`） |
| selected | `bg-state-selected`；**不能只靠字重**表达选中 |
| focus-visible | `ring-2 ring-ring/50`，键盘可达；输入类控件额外 `border-ring` |
| disabled | `opacity-50` + `cursor-not-allowed`，并阻止事件；不改变文字色阶 |
| loading | `Spinner` + 文案（「加载中…」），不阻塞其它交互 |
| empty | 见「反馈」的空态五要素 |
| error | `bg-destructive/10` + `text-destructive`，描边 `border-destructive/40` |
| running / streaming | 与普通态可区分（加载指示在行尾），不阻塞其它交互 |

## 对齐与可读性

- 单行内容用 `items-center`；带副标题的块用 `items-start`，图标与标题首行对齐。
- 截断：单行 `truncate` + `title` 兜底；需要说明含义的用 Tooltip，不靠 `title` 讲操作。
- 可点目标最小 24px（`size-6`）；紧凑列表行里的图标按钮用 `size-6`，不要更小。
- 长内容优先 `max-h-*` 折叠并给展开入口，而不是把屏幕占满。
- 列表与表格里的数字右对齐并加 `tabular-nums`。

## 无障碍

- 对比度：正文 ≥ 4.5:1，大字号与非文本（描边、焦点环、图表线）≥ 3:1。
- 焦点始终可见：不写 `outline: none` 而不补 ring；分隔条等自定义命中区也要给键盘焦点样式。
- 不只靠颜色表意：git 状态配字母徽标、错误配文案、选中配底色或勾选。
- 表单控件与 `Label` 关联；纯图标按钮必须带 `title` 或 `aria-label`。
- 尊重 `prefers-reduced-motion`。

## 响应式

- 布局断点只用 `md`(768)：三栏退化为抽屉与单列；`sm`(640) 只用于弹层宽度。不引入 `lg` / `xl`，需要更细的密度差异时改 `max-width` 或可见性，而不是改变组件语义。
- 面板**内部**的自适应走容器查询（`@container` + `@[<宽>]` 变体），不用窗口断点：分栏可拖、面板宽度与窗口宽度不是一回事。
  现有的两处是输入区工具栏（36rem 以下只留图标）与工作台的文件 / 改动标题行。
- 窄屏表单控件用 `text-base`（16px）防 iOS 聚焦缩放，这是字号体系之外唯一的固定例外。

## 第三方依赖

外部组件带自己的变量与数字字号时，按两条规则接：

1. **样式映射**：在 `styles/third-party.css` 里把库的变量整组改写成语义 token（现例：`@git-diff-view/react` 的 `--diff-*`），
   库样式必须先于映射引入（入口 `theme.css` 的顺序即为此）。映射里同样禁止字面色值。
2. **数值字号**：库只接受数字字号时，用 `hooks/use-token-number` 读基准参数换算（现例：diff 行字号 = 基准的 6/7），
   而不是写死常量——否则改字号时它会掉队。
3. **颜色采样**：库自己解析颜色字符串时，不能直接读变量的 computed 值——语义层用 `color-mix()` 合成，
   读出来是未求值的表达式（如 `color-mix(in oklab, oklch(…), transparent)`）。要经浏览器求值：
   本仓库走 `business/markdown/mermaid-color.ts` 的 1×1 canvas 采样（`CSS.supports` 先校验再采样，得 sRGB 四通道），
    mermaid 的颜色引擎与语法高亮都吃这一层。

## 配色主题

- 主题只换配色，写在 [`packages/ui/src/styles/themes/`](./packages/ui/src/styles/themes/)：
  覆盖 `--theme-shell` / `-panel` / `-raised` / `-solid` / `-text` / `-primary` / `-primary-fg` / `-ring` / `-line` 这九个变量（深浅各一块），
  强度类变量（`-text-soft` / `-text-faint` / `-line-soft` / `-overlay` / `-shadow-*`）按需覆写。
- 选择器必须写 `html[data-theme="…"]` 与 `html.dark[data-theme="…"]`：后者不可省，否则深色会被基础主题层盖回去。
- 新增主题要同时在 `provider/themes.ts` 的 `COLOR_THEME_IDS` 登记；`scripts/verify` 的 `themes` 校验比对两份清单与覆盖完整性。
- 主题不影响字体、字号与圆角——「换风格」需要新主题，而不是改这几个旋钮。

## 新增 token 的流程

1. 先确认现有语义表达不了（多数需求能由 `state-*` / 三级前景 / 高度层覆盖）。
2. 定层：参数（设置可改）、主题层（配色可换）、语义层（组件用），再定名。
3. 进 `tokens.css` 并映射成工具类；如果它是「可枚举的尺寸档位」，同时进 `scripts/verify/checks/design.ts` 的白名单。
4. 更新本文件与 `CHANGELOG.md`。
