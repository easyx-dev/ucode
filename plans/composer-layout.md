# 输入区与空态布局重构：项目 / 分支条、「+」菜单与带说明的选择器

> 来源：本轮需求「对话区 UI 与布局重构」的四张参考图（新会话 hero、工作区弹层、「+」菜单、
> 模式 / 权限弹层）与已有对话的输入区截图。
> 关联：[`composer.md`](./composer.md)（输入区的编辑器、`@` / `/`、附件内联）、
> [`ui-convergence.md`](./ui-convergence.md)（批次一 / 二的输入区与消息区修订）、
> [`attachment-token.md`](./attachment-token.md)（同区并行：编辑器里的附件 chip 改文字 token、消息回放跟着换）
> ——那边只动 `composer/attachment-chip.tsx` 的节点视图与消息区，与本轮的容器结构 / chip 条 / 工具栏无重叠；
> 两边都改 `DESIGN.md`，落地时按小节合并（它改「消息区」，本文件新增「输入区」）。
> 视觉口径落 `DESIGN.md`，组件口径落 `docs/components.md`。
>
> 状态：**未开始**（方案定稿，待实施）。

## 一、背景与目标

输入区（`packages/ui/src/business/composer.tsx`）现在是「白卡 + 卡内 `FolderOpen + cwd` 行 +
编辑器 + 底部工具栏（模型 / 模式 / 权限 / 思考 / 发送）」，空态是消息列表里的 `WelcomePanel`
（`brand.name` 文字水印 + 一段「模型已就绪」说明）。三处不足：

1. **不知道在哪儿干活**：工作目录只在输入卡顶部一行灰字里，分支完全没有——分支信息目前只活在工作台
   的「改动」标签里。
2. **空态不像「起点」**：水印是文字、问候语只有一句、建议 chips 夹在输入卡上方且没有图标；输入卡钉在
   底部，与问候语分属两个区域。
3. **下拉没有说明**：模式与权限档位只有名字（说明文案写在 `title` 上，要悬停才看得到），参考图把它们
   做成「图标 + 标题 + 副标题」。

**做**（本轮范围＝输入区与空态）：

- 输入卡改**双层**：外层灰底容器的首行是「项目 chip（草稿态可切换）+ 分支 chip（只读）」，下面才是
  原来那张白卡；卡内那行 `FolderOpen + cwd` 删掉。
- 空态改**居中 hero**：品牌图水印 + 按时段的问候语 + 输入卡 + 卡下方的建议 chips（带图标）。
- 新增 **「+」菜单**：只列有真实行为的项——附件、技能（各自都有现成实现）。
- 模式 / 权限 / 思考三个选择器改成**「标题 + 副标题」弹层**（`DropdownMenu` 的 radio 组）。
- 占位符按状态分两种；草稿态可以预设权限档位（会话创建接口本来就收 `permissionMode`）。

**明确不做**：

- **消息区**不动：`message-*.tsx`、`chat-rows.ts`、`lib/message-chips.ts` 一律不改。参考图里
  「N 个文件已更改 / 撤销」需要按轮做 git 快照与 revert 接口，另起一次方案。
- **参考图里我们没有的入口不进菜单**：远程连接（[`relay.md`](./relay.md) 暂缓）、工作流（无实现）、
  插件市场（[`plugins.md`](./plugins.md) 暂缓）都不出现在「+」菜单与工作区弹层里，不做「即将推出」占位。
- **已有会话的项目 / 分支不可切换**：会话 `cwd` 建后不改，git 侧只有只读接口（`status` / `diff` /
  `log` / `show`），所以这两枚 chip 在已有会话里是只读展示，不提供 checkout 或换目录。
- 不动服务端、契约与 SDK：`sessionCreateInputSchema` 已有 `permissionMode`，其余全是客户端改动。
- 不动侧栏（它的「新建任务 / 小助理 / 打开工作区」入口保留）。

## 二、参考图 → 现状对照

| 参考图元素 | 现状 | 本轮 |
| --- | --- | --- |
| 大尺寸品牌水印 | `brand.name` 文字（`text-7xl` + `text-foreground/5`） | `BrandLogo` 大尺寸 + 低透明度（跟随深浅色资产） |
| 问候语「上午好呀，有什么想让我帮忙的吗」 | 按 4 个时段给「×好，接下来交给我吧」 | 按 4 个时段改成「…好呀，有什么想让我帮忙的吗」 |
| 问候下方的说明段 | 「模型已就绪：{{model}}。每个会话有独立的工作区 <path>」 | **删掉**：模型在工具栏、工作区在项目 chip，信息重复 |
| 输入卡 + 卡下建议 chips | 输入卡 + 卡**上**建议 chips（无图标） | 顺序对调、加图标，见 §四.6 |
| 项目 chip `× 名称 ⌄` | 无（只有卡内一行 cwd 文本） | 草稿态可选、已有会话只读，见 §四.4 |
| 分支 chip `⑂ master ⌄` | 无（只活在工作台） | 只读 chip，见 §四.4 |
| 工作区弹层（搜索 + 最近 + 打开文件夹 + 不在项目中工作） | 只有侧栏的「打开工作区」与命令面板入口 | 新弹层，见 §四.5（「远程连接」不做） |
| 「+」菜单（添加 / 插件 / 提示行） | 无 | 「添加 → 附件」「技能 → 技能清单」+ 提示行，见 §四.7 |
| 带副标题的模式 / 权限弹层 | `Select`，说明挂 `title` | `DropdownMenu` radio 组，见 §四.2 / §四.3 |
| 已有对话的输入区（占位「提出后续修改要求」） | 单一占位符 | 按状态分两种占位符，见 §四.8 |
| 附件文件卡 / 「N 个文件已更改 + 撤销」 | 消息区渲染 | **本轮不做**（见「明确不做」） |

## 三、已锁定的决策

1. **范围限输入区与空态**：消息区、`docs/session-entries.md`、服务端与契约都不动。
2. **参考图里没有实现的入口一个都不出现**：菜单只列能真的做出行为的项，宁可比参考图少两行，不摆
   「即将推出」的占位（那会让菜单元数据看起来比实际能力大）。
3. **项目 / 分支 chip 已有会话只读**：显示当前项目名（助理区会话显示「助理区」）与当前分支，都不可切换；
   分支取不到（非 git 目录、分离头指针、未加载到）就不渲染这枚 chip。
4. **模式与权限是两个独立选择器**：工具栏并排保留「模式」与「权限」两个控件，各自弹层采用参考图的
   「图标 + 标题 + 副标题」样式。不学参考图把「计划模式」并进权限菜单——在本项目里模式是
   「工具集 + 提示词 + 权限基线」的三元组，权限档位只决定命中 `ask` 时的放行方式（见
   [`docs/modes-and-permissions.md`](../docs/modes-and-permissions.md)），合成一个入口会掩盖这个差别。
5. **弹层交互用 `base/dropdown-menu` 的 radio 组**：互斥且带说明的选项要的是「菜单 + 选中态 + 键盘导航」，
   Radix 的 `RadioGroup` / `RadioItem` 自带 `role="menuitemradio"`、方向键与 Esc、关闭后焦点回收；
   自己用 `Popover` + 按钮列表会丢掉这些，用 `Select` 则塞不下副标题。`docs/components.md` 的
   「组件选型」补一句口径（带说明走菜单，不带说明用 `select`）。
6. **草稿态可预设权限档位**：`sessionCreateInputSchema` 已有 `permissionMode`，草稿加 `permissionMode`
   字段并在建会话时带上，权限选择器在草稿态不再 `disabled`。这是本轮唯一的**行为变化**，不想放开就
   只保留禁用态（改动收敛为「选择器换皮」）。
7. **hero 与对话态共用同一个输入区挂载点**：输入卡始终挂在 `ChatPanel` 那个 `relative` 容器里
   （决策面板的底衬依赖它），hero 只让这个容器 `flex-1 justify-center` 并把问候块渲染在输入卡上方——
   父节点不变，编辑器不会因为布局切换而重挂载丢草稿。
8. **项目 / 分支条的两层结构遵循 `DESIGN.md` 的表面取法**：外层是 `bg-muted/50` 的圆角容器，内层输入卡
   仍是 `bg-popover` + `ring-1 ring-foreground/10`；不在 `bg-card` 上再套 `bg-card`（白叠白分不出层）。
9. **「+」菜单的技能与 `/` 菜单同源**：都用 `useCommands` 的 `skills`，插入的节点也都是 `commandMention`
   （`/skill:name`）——一份数据、一种序列化，不新增第二种技能入口的语义。
10. **不新增依赖**：图标用已装的 `lucide-react`，弹层用已装的 `radix-ui`，附件选择用原生
    `input[type=file]`。

## 四、改动清单

### 1. `packages/ui/src/lib/workspace-list.ts`（新）

```ts
/** 「在哪儿干活」的候选项：一个已知的项目目录 */
export type WorkspaceOption = {
  /** 项目目录绝对路径 */
  path: string;
  /** 展示名（目录名） */
  name: string;
};

/** 从会话列表派生最近用过的项目目录：剔除助理区、按 cwd 去重，保持入参顺序（已是 updatedAt 降序） */
export const recentWorkspaces = (
  sessions: readonly SessionSummary[],
  workspacesDir: string | null,
): WorkspaceOption[] => …
```

- 助理区判定复用 `isWorkspaceSession`（`lib/session-groups.ts`），展示名用 `baseName`（`lib/path.ts`）。
- 不加 `limit` 参数：调用方按需 `slice`，列表滚动兜住（弹层内限高）。
- 配 `packages/ui/src/lib/__tests__/workspace-list.test.ts`：助理区被剔除、同 cwd 只留最近一条、
  顺序稳定、`workspacesDir` 为 null 时全部保留。

### 2. `packages/ui/src/business/picker-options.tsx`（新）

三个选择器共用的选项体（不含触发钮）：

```ts
export type PickerOption = {
  value: string;
  label: string;
  /** 副标题：这档位会做什么 / 放宽什么，缺省则不占行 */
  description?: string;
  icon?: LucideIcon;
};

/** 互斥选项的菜单体：图标 + 标题 + 副标题，右侧由 RadioItem 的指示器打勾 */
export function PickerOptions({ options, value, onSelect }: PickerOptionsProps) { … }
```

- `DropdownMenuRadioGroup` + `DropdownMenuRadioItem`；条目 `className` 覆盖成
  `flex-col items-start gap-0.5 py-1.5 pr-8`，标题 `text-sm`、副标题 `text-xs text-muted-foreground`。
- 选中态靠 `DropdownMenuRadioItem` 自带的指示器（`CheckIcon` 绝对定位在右），不靠字重。

### 3. 三个选择器（`business/mode-picker.tsx` / `permission-picker.tsx` / `thinking-picker.tsx`）

- `Select` → `DropdownMenu`：`Root` 保留受控 `open` / `onOpenChange`（`/mode`、`/permission`、
  `/thinking` 三个内置命令从外部唤起，不传则内部自管），`Trigger asChild` 的按钮沿用现在的样式
  （`text-xs text-muted-foreground hover:bg-muted`、`[&_svg]:size-3.5`），末尾补 `ChevronDown`。
- 权限：`full` 档仍走 `warning` 色；三项的副标题取 `permissionModeDescription`。
- 模式：副标题取 `modeDescription`（`build` / `plan` / `ask`）。
- 思考：条目只有标题（`THINKING_PREFERENCES` + `thinkingPreferenceLabel`），触发钮上的「自动 · 极高」
  展示逻辑不变。
- `Content` 用 `side="top" align="start"`（控件在底部）与 `w-72`（`DropdownMenuContent` 默认取触发钮宽度，
  放不下副标题）。
- 三个组件的 props 形状不变，`composer.tsx` 与 `workspace-layout.tsx` 的调用点只删 `disabled`（见 §四.9）。

### 4. `business/composer/project-row.tsx`（新）

输入卡上方的条（外层容器的首行）：

- 草稿态：渲染 `<ProjectPicker />`（§四.5）。
- 已有会话：只读 chip——图标 + `baseName(session.cwd)`（助理区会话显示 `t("助理区")`），
  `title` 给 `abbreviateHome(cwd)` 的全路径；不可点、无下拉。
- 分支 chip：两态都有，`useGitStatus(cwd)`（`hooks/use-workbench-data.ts`）取 `branch`，
  `isRepo && branch` 为真才渲染，`GitBranch` 图标 + 分支名，`title` 为「当前分支」，只读。
  `cwd` 取 `session?.cwd ?? draft.cwd ?? null`。
- 整行留白与 chip 样式：`px-2 py-1.5`，chip 用 `rounded-md px-1.5 py-0.5 text-xs`。

### 5. `business/composer/project-picker.tsx`（新）

草稿态的项目 chip + 弹层（`DropdownMenu`，`side="top"`）：

- 触发钮：`X` 图标按钮（清掉项目 → 小助理，`stopPropagation`）+ 项目名 + `ChevronDown`；未绑定项目时
  显示 `t("小助理")`（与侧栏同一套用词），`title` 说明「不绑定项目，会话落在助理区」。
- 内容：
  - 顶部搜索框（筛选项目名与路径，本地过滤）；
  - 最近工作区列表（`recentWorkspaces` + `useSessions()`），当前项打勾；
  - 分隔线 + 「选择目录」（`openDirectoryPickerDialog()`，与侧栏 / ⌘O 同一个弹层）+「小助理」。
- 选择结果由 `onSelect(path: string | null)` 往外抛，`Composer` 透传给 `ChatPanel`（§四.9 落草稿）。
- 列表为空时给一句 `t("还没有打开过项目")`，不留空白。

### 6. `business/composer/suggestions.tsx`（新）

卡下方的建议 chips：`rounded-full border border-border px-3 py-1`，图标 `size-3.5`，悬停 `hover:bg-muted`；
点击仍然是**填入输入框**（不直接发送），沿用现在的 `fill` 语义。

| 文案 | 图标 |
| --- | --- |
| 了解这个项目 | `Compass` |
| 排查构建报错 | `Bug` |
| 补充单元测试 | `FlaskConical` |
| 重构这段代码 | `Wrench` |

文案保持现有四条（参考图里的「周报总结 / 报错修复 / PPT 制作 / 闲时任务」是另一款产品的能力面，
照抄会承诺我们做不到的事）。

### 7. `business/composer/add-menu.tsx`（新）

「+」的 `DropdownMenu`（`side="top" align="start"`，`w-80`）：

- 分组「添加」：**附件** → 触发组件内隐藏的 `<input type="file" multiple>`，`onChange` 走
  `useComposerAttachments.addFiles`（与粘贴 / 拖拽同一条路径，不设 `accept`）。
- 分组「技能」：`useCommands(sessionId, cwdPath).skills` 列表，点击插入 `/skill:name`（§四.10 的
  `insertCommand`）；技能为空时给一句 `t("当前目录没有技能")`；已有命令节点时菜单项禁用并提示
  原因（见 §四.10 的返回值）。
- 底部提示行（`text-xs text-muted-foreground`）：`@ 添加上下文`、`/ 选择命令或技能`——只列真实存在
  的前缀，不出现 `$` 与「搜索插件」（我们没有插件机制）。
- 不列：工作流、插件市场、远程连接。

### 8. `business/composer.tsx`（改）

- 容器改双层：外层 `rounded-xl bg-muted/50`，首行 `<ProjectRow />`，其下是原来的白卡
  （`rounded-lg bg-popover ring-1 ring-foreground/10` + `focus-within:ring-2`）；**删掉**卡内的
  `FolderOpen + cwd` 行与 `FolderOpen` 导入。
- 底部工具栏顺序：左 `+`（`AddMenu`）· 模式 · 权限 | 右 模型 · 思考 · 发送。发送 / 停止按钮不变。
- 建议行移到白卡**下方**（`showSuggestions` 为真时渲染 `<ComposerSuggestions onSelect={fill} />`）；
  props 由 `suggestions?: readonly string[]` 改为 `showSuggestions?: boolean`。
- 占位符：`showSuggestions` 为真时用
  `t("向 {{name}} 提问，使用 @ 添加上下文，使用 / 选择命令或能力", { name: brand.name })`，
  否则用 `t("提出后续修改要求")`。
- 权限选择器不再传 `disabled={sessionId === null}`；`permissionMode` 取
  `session?.permissionMode ?? draft.permissionMode ?? DEFAULT_PERMISSION_MODE`（草稿来自 §四.9 新增的 prop）。
- 草稿态的项目名与 `cwd` 由新增 prop 传入（`projectName` / `projectPath` 与 `onSelectProject`），
  组件自身不读会话列表（列表在 §四.5 的弹层里按需读）。

### 9. `business/chat-panel.tsx`（改）

- **hero**：`hero = !chat.loadingHistory && chat.items.length === 0 && !chat.streaming && !isChild`。
  hero 时不渲染 `MessageList`（`MessageList` 的 `empty` 仍保留——子会话小窗在用），并把「输入卡 + 决策区」
  那个 `relative` 容器改成 `cn("relative", hero && "flex min-h-0 flex-1 flex-col justify-center")`，
  在 `inert` 包装里、`<Composer>` 之前渲染 `<WelcomePanel />`。**输入卡的位置不能挪到 hero 分支里**，
  否则父节点变化会让编辑器重挂载（见决策 7）。
- 把 `empty` prop 从 `MessageList` 的调用点去掉（hero 与之互斥，对话态不需要空态）。
- 传 `showSuggestions={hero}`；`suggestions` 数组删掉（文案搬进 §四.6）。
- 项目选择：`onSelectProject={(path) => composer.update(draftKey, { cwd: path ?? undefined })}`，
  项目名与路径从 `draft.cwd` 派生后传给 `Composer`。
- 发送 seed 带上 `permissionMode: draft.permissionMode`。

### 10. `business/composer/editor-handle.ts`（改）

句柄加一个方法，供「+」菜单插入技能：

```ts
/** 在文档开头插入命令 / 技能节点；正文开头已有一条时返回 false（命令只能整条匹配，再插一条会作废） */
insertCommand: (command: { kind: "prompt" | "skill"; name: string; label: string }) => boolean;
```

- 实现：文档首个非空节点已是 `commandMention` → 返回 `false`；否则 `insertContentAt(1, [节点, 空格])`
  并 `focus("end")`（参数写在正文尾部，与 `/goal` 的「命令名 + 参数」语义一致）。
- `business/composer/add-menu.tsx` 按返回值决定是否提示（提示文案 `t("正文开头已经有一条命令或技能")`）。

### 11. `business/welcome-panel.tsx`（改）

- 水印：`brand.name` 文字 → `<BrandLogo className="h-20 opacity-[0.07]" />`（`aria-hidden`；深浅色资产由
  `BrandLogo` 自己切）。
- 问候语 4 条改为：`深夜好呀，有什么想让我帮忙的吗` / `上午好呀，…` / `下午好呀，…` / `晚上好呀，…`。
- props 精简为 `{ configured, onOpenSettings }`：删 `defaultModel` / `workspacesDir` 与那段
  「模型已就绪」说明（理由见 §二）；`configured === false` 的分支（标题 + 说明 + 「打开设置」按钮）保留。
- 级联：`presets/workspace-layout.tsx` 的 `<WelcomePanel>` 调用点少传两个 props。

### 12. `packages/ui/src/lib/composer-draft.ts` 与 `presets/workspace-layout.tsx`（改）

- `ComposerDraft` 加 `permissionMode?: PermissionMode`，`toDraft` 里按字符串校验保留。
- `workspace-layout.tsx` 的 `selectPermissionMode`：无会话时
  `composer.update(draftKey, { permissionMode: mode })`，有会话时保持 `sessions.setPermissionMode`。

## 五、i18n（`packages/i18n/src/locales/ui/en.ts`）

中文目录不登记（key 即文案，`scripts/verify` 的 i18n 检查会拦冗余条目），en 补齐：

- 问候语 4 条、两个占位符（`向 {{name}} 提问，使用 @ 添加上下文，使用 / 选择命令或能力` 与
  `提出后续修改要求`）；
- 项目 / 分支条：`项目`、`当前分支`、`小助理`（已有）、`不绑定项目，会话落在助理区`、`选择目录`（已有）；
- 工作区弹层：`搜索工作区`、`最近工作区`、`还没有打开过项目`；
- 「+」菜单：`添加`、`附件`、`技能`（已有）、`当前目录没有技能`、`正文开头已经有一条命令或技能`、
  `@ 添加上下文`、`/ 选择命令或技能`；
- 建议 chips 四条文案已有（`了解这个项目` / `排查构建报错` / `补充单元测试` / `重构这段代码`）。

## 六、文档

- `DESIGN.md`：
  - 「排版」表的「空态水印」行改为「品牌图（`BrandLogo`）大尺寸 + 低透明度，装饰性（`aria-hidden`）」，
    「空态问候语」行补「按时段取词，与输入卡、建议行同属居中 hero」；
  - 新增「输入区」一节（与「消息区」并列）：双层结构（外层 `bg-muted/50` 容器 + 首行项目 / 分支条 +
    内层 `bg-popover` + `ring-1 ring-foreground/10` 的输入卡）、工具栏构成（`+` · 模式 · 权限 | 模型 ·
    思考 · 发送）、建议行在卡下方、空态居中条件。
- `docs/components.md`：「组件选型」补「互斥选项带说明时用 `base/dropdown-menu` 的 radio 组（菜单语义，
  键盘与焦点回收由 Radix 保证），不带说明时用 `base/select`」。
- `CHANGELOG.md`：`[未发布] → 新增` 记一条（输入区与空态改版：项目 / 分支条、「+」菜单、带说明的模式 /
  权限选择器、草稿态可预设权限档位）。
- 本文件落地后补「复盘」一节（实际偏差）。

## 七、验证

- `pnpm check` 一轮一次（biome + 各包 typecheck + 单测 + `pnpm verify`，含 i18n / tokens / brand 校验）。
- `agent-browser` 走查一轮（`pnpm dev` 开 `:5173`；一批改动只走一次）：
  1. 空态 hero：水印、问候语、居中输入卡、卡下建议 chips 点击填入输入框；
  2. 项目弹层：搜索过滤、最近工作区打勾、选一个项目后 chip 更新、「选择目录」弹层、「小助理」清绑定；
  3. 分支 chip：git 项目里显示分支名、非 git 目录不出现；
  4. 「+」菜单：附件走文件选择器入库并出现 chip；技能插入到正文开头、已有命令时提示且禁用；
  5. 三个选择器：弹出位置在控件上方、副标题可见、`完全访问` 为 warning 色、选中打勾、Esc 关闭后焦点
     回到编辑器；`/mode`、`/permission`、`/thinking` 仍能唤起；
  6. 切换会话：已有会话的输入区同形、项目 chip 只读且显示「助理区」或项目名；
  7. 发送：hero → 对话态切换不丢草稿（先打几个字再发、再发一条失败回填的边界）；
  8. 草稿态预设权限档位 → 新建会话后该档位生效（`sessions/list` 或界面 chip 复核）。

## 八、风险与边界

- **`Select` → `DropdownMenu` 是交互实现替换**：语义从 listbox 变 menuitemradio。这是 `docs/components.md`
  允许的取法（带说明的互斥选项走菜单），但读屏行为随之变化，走查要过一遍键盘路径。
- **hero 依赖「输入卡父节点不变」**：实现时不要为了少一层 DOM 把输入卡挪进 hero 分支，否则空对话发第一条
  消息会重挂载编辑器（草稿回填与附件占位可能丢）。
- **占位符在挂载时定稿**：Tiptap 的 options 只在挂载时算一次（`composer/editor.tsx` 的 `options` ref），
  所以占位符只靠「`editorKey` 变化 / 文档被外部重置」触发重挂载——发送后清空草稿正好会走到这条路径，
  但改动时不要改成「只按状态切换文案」。
- **项目列表来自会话**：没在任何项目里开过会话时列表为空，只有「选择目录」与「小助理」两项——这是诚实
  的口径（我们不知道用户机器上有哪些目录，也不维护「最近打开的文件夹」历史）。
- **分支 chip 可能过期**：只在 `cwd` 变化时取一次；agent 在会话中途切了分支不会自动刷新（只读展示，
  是否加 `agent_settled` 刷新留待走查后决定）。
- **草稿态权限档位是行为变化**：放开后新建会话会带上该档位（例如草稿选了「完全访问」，首条消息就在
  完全访问下跑）。若认为风险不可接受，退化成保持 `disabled`，其余改动不受影响。
- **不动 `cwd` 的可切换性**：参考图的项目 chip 带下拉（可换项目），已有会话我们只做只读——需要变更
  会话 `cwd` 就等于改服务端语义与会话文件，不在本轮。
- **不做响应式特例**：窄屏下同一套结构（chip 条照常显示），不额外加抽屉或折叠。

## 九、落地顺序

1. `lib/workspace-list.ts` + 单测；
2. `business/picker-options.tsx` → 三个选择器改造（此时输入区尚未改结构，先保证功能与键盘可用）；
3. `business/composer/project-row.tsx` / `project-picker.tsx` / `add-menu.tsx` / `suggestions.tsx` +
   `editor-handle.ts` 的 `insertCommand`；
4. `business/composer.tsx` 双层结构与工具栏 → `business/chat-panel.tsx` hero 与草稿接线 →
   `business/welcome-panel.tsx` + `presets/workspace-layout.tsx` + `lib/composer-draft.ts`；
5. i18n（en）+ `DESIGN.md` + `docs/components.md` + `CHANGELOG.md`；
6. `pnpm check` + 浏览器走查 → 停下等 review（未获批准不提交）。
