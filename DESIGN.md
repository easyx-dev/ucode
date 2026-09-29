# 设计规范

ucode 对话界面的视觉系统。实现落位：`apps/web/src/index.css`（token）与 `apps/web/src/components/`（组件）。

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
| primitive | `index.css` 里的 `oklch()` 字面量 | 只描述颜色本身，不带业务含义，不出现在组件里 |
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
| 空态问候语 | `text-xl font-semibold` | 界面上最大的正文层级 |
| 空态水印 | `text-7xl font-semibold` + `text-foreground/5` | 纯装饰（`aria-hidden`），不算文字层级 |
| 代码、路径、内联片段 | `font-mono text-xs` | 配 `rounded-sm bg-muted` |

- 中文正文用 `leading-relaxed`；密集列表用默认行高
- 字重只用 `normal` / `medium` / `semibold` 三档，不用 `bold`
- 不用斜体、不用全大写做标题

## 间距与密度

- 基准 4px；间距只用 Tailwind 的 `gap-*` / `p-*` 档位
- 控件高度：小 `h-7`、默认 `h-8`、大 `h-9`；图标按钮同高同宽
- 列表行高 36px（`h-9`），行内边距 `px-2`
- 卡片内边距 12–16px（`p-3` / `p-4`）；区块间距 16–24px

## 阴影

- 默认无阴影，靠 `border` 与底色差分层
- 仅弹层、下拉、对话框可用极轻阴影（基础组件已带默认值，不要额外叠加）
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

- 在 `index.css` 新增 `[data-theme="<名>"]` 层，只覆盖 semantic token，**不动 primitve 结构之外的组件**
- 主题名只影响 token，不影响任何 `className`
- 新增主题必须同时给出浅色与深色两套值
